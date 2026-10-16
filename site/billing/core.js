/* Billing core: pure rules, no DOM. Loaded by index.html and by the Node tests.
 *
 * Slovenian rules implemented here (sources in the Compliance page):
 * - ZDDV-1 Art. 82: mandatory invoice data; VAT amount in EUR; clauses for exemption,
 *   reverse charge ("Obrnjena davčna obveznost") and small taxpayers (Art. 94).
 * - ZDDV-1 Art. 81: invoices for intra-EU supplies / reverse-charge services by the 15th of
 *   the following month.
 * - ZDavP-2 Art. 38(8): issued records are never changed or deleted; corrections are credit
 *   notes that reference the original, and every change is kept in a hash-chained log.
 * - ZDavPR: card or cash payments are "cash business" and need fiscal verification, so this
 *   app records bank transfers (TRR) only.
 */
(function (root) {
  'use strict';

  const VAT_RATES = [22, 9.5, 5];

  const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT',
    'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);

  // Tax treatment of a whole document. `vat` = whether Slovenian VAT is charged on it.
  // Clauses are the wording FURS uses in "Podrobnejši opis – Računi" (§3.1, §3.4, §3.4.1).
  const TREATMENTS = {
    domestic: {
      label: 'Domestic (Slovenian VAT)', vat: true, buyerVatId: false,
      clause: { sl: '', en: '' },
    },
    domestic_reverse: {
      label: 'Domestic reverse charge (Art. 76.a)', vat: false, buyerVatId: true, kir: 'domestic_rc',
      clause: { sl: 'Obrnjena davčna obveznost – DDV obračuna prejemnik po 76.a členu ZDDV-1.',
        en: 'Reverse charge – VAT is accounted for by the recipient under Article 76.a ZDDV-1.' },
    },
    eu_services: {
      label: 'EU business – services (reverse charge)', vat: false, buyerVatId: true, eu: true, rpo: 'services', by15th: true, kir: 'eu_services',
      clause: { sl: 'Obrnjena davčna obveznost, DDV ni obračunan po prvem odstavku 25. člena ZDDV-1.',
        en: 'Reverse charge, VAT is not settled under Article 44 of Directive 2006/112/EC.' },
    },
    eu_goods: {
      label: 'EU business – goods (exempt intra-EU supply)', vat: false, buyerVatId: true, eu: true, rpo: 'goods', by15th: true, kir: 'eu_goods',
      clause: { sl: 'Oproščeno plačila DDV po 1. točki prvega odstavka 46. člena ZDDV-1.',
        en: 'Exempt intra-Community supply – Article 138 of Directive 2006/112/EC.' },
    },
    export_services: {
      label: 'Outside the EU – services', vat: false, buyerVatId: false, kir: 'outside_si',
      clause: { sl: 'DDV ni obračunan – kraj opravljanja storitve ni v Sloveniji (prvi odstavek 25. člena ZDDV-1).',
        en: 'VAT not charged – the place of supply is outside Slovenia (Article 25(1) ZDDV-1).' },
    },
    export_goods: {
      label: 'Outside the EU – goods (export)', vat: false, buyerVatId: false, kir: 'export',
      clause: { sl: 'Oproščeno plačila DDV po 1. točki prvega odstavka 52. člena ZDDV-1.',
        en: 'Exempt export supply – Article 146 of Directive 2006/112/EC.' },
    },
  };

  // Not registered for VAT (small taxpayer, Art. 94(1) ZDDV-1): no VAT on any document.
  const SMALL_TAXPAYER_CLAUSE = {
    sl: 'DDV ni obračunan na podlagi prvega odstavka 94. člena ZDDV-1.',
    en: 'VAT not charged under Article 94(1) ZDDV-1 (not registered for VAT).',
  };

  const pad = (n, w) => String(n).padStart(w, '0');
  const isoDate = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  };
  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + Number(n || 0));
    return d.toISOString().slice(0, 10);
  };
  const dmy = (iso) => (iso ? `${iso.slice(8, 10)}. ${iso.slice(5, 7)}. ${iso.slice(0, 4)}` : '');
  const monthOf = (iso) => (iso || '').slice(0, 7);
  const lastDayOfMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate(), 2)}`;
  };
  const prevMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1, 2)}`;
  };

  // ---------- money (integer cents) ----------
  const cents = (v) => Math.round((Number(v) || 0) * 100);
  // Always group thousands (1.683,60 €), as on Slovenian invoices; sl-SI alone skips it below 10.000.
  const eur = (c, { sign = false, whole = false } = {}) => {
    const v = (Number(c) || 0) / 100;
    const d = whole ? 0 : 2;
    const s = v.toLocaleString('sl-SI', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });
    return `${sign && v > 0 ? '+' : ''}${s} €`;
  };
  const plainNumber = (c) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');

  // ---------- documents ----------
  function treatmentOf(doc) { return TREATMENTS[doc.treatment] || TREATMENTS.domestic; }

  // Line net = qty × unit price × (1 − discount), rounded to cents per line. VAT is computed
  // once per rate on the summed base, as Art. 82 allows ("seštejejo, od seštevka se obračuna").
  function computeTotals(doc, settings) {
    const t = treatmentOf(doc);
    const chargesVat = !!(settings && settings.vatRegistered) && t.vat;
    const lines = (doc.lines || []).map((l) => {
      const gross = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
      const net = Math.round(gross * (1 - (Number(l.discountPct) || 0) / 100) * 100);
      const rate = chargesVat ? Number(l.vatRate) : 0;
      return { ...l, net, rate };
    });
    const byRateMap = new Map();
    for (const l of lines) {
      const r = byRateMap.get(l.rate) || { rate: l.rate, base: 0, vat: 0 };
      r.base += l.net;
      byRateMap.set(l.rate, r);
    }
    const byRate = [...byRateMap.values()].sort((a, b) => b.rate - a.rate);
    for (const r of byRate) r.vat = Math.round(r.base * r.rate / 100);
    const net = byRate.reduce((a, r) => a + r.base, 0);
    const vat = byRate.reduce((a, r) => a + r.vat, 0);
    return { lines, byRate, net, vat, total: net + vat, chargesVat };
  }

  function clausesFor(doc, settings, lang) {
    const out = [];
    if (!settings.vatRegistered) out.push(SMALL_TAXPAYER_CLAUSE[lang]);
    else {
      const c = treatmentOf(doc).clause[lang];
      if (c) out.push(c);
    }
    return out;
  }

  const formatNumber = (prefix, year, seq) => `${prefix || ''}${year}-${pad(seq, 4)}`;
  // Model SI00 (no check digit), the same as Alphasyn Billing: digits and hyphens only.
  const paymentReference = (year, seq) => `SI00 ${year}-${pad(seq, 4)}`;

  function issuedDocs(state) { return state.invoices.filter((i) => i.number); }

  function nextSeq(state, year) {
    return (state.counters[String(year)] || 0) + 1;
  }

  function lastIssueDate(state, year) {
    return issuedDocs(state).filter((i) => i.year === year).map((i) => i.issueDate).sort().pop() || null;
  }

  function creditedCents(state, inv) {
    return state.invoices.filter((c) => c.kind === 'credit_note' && c.creditOf === inv.id && c.number)
      .reduce((a, c) => a + (c.snapshot ? c.snapshot.totals.total : 0), 0); // negative
  }
  const paidCents = (inv) => (inv.payments || []).reduce((a, p) => a + p.amount, 0);
  // Money paid back to the client (after a credit note on an invoice that was already paid).
  const refundedCents = (inv) => (inv.refunds || []).reduce((a, r) => a + r.amount, 0);
  const lastPaymentDate = (inv) => (inv.payments || []).map((p) => p.date).filter(Boolean).sort().pop() || null;

  // What the client still owes on an issued invoice (positive) or is owed back (negative):
  // total − credit notes − payments received + refunds paid out.
  function balanceCents(state, inv) {
    if (!inv.number || inv.kind === 'credit_note') return 0;
    return inv.snapshot.totals.total + creditedCents(state, inv) - paidCents(inv) + refundedCents(inv);
  }

  // Draft · Issued · Partly paid · Paid · Overdue · Credited · Refund due (credit notes: Issued / Draft).
  function statusOf(state, inv, today = todayIso()) {
    if (!inv.number) return 'draft';
    if (inv.kind === 'credit_note') return 'issued';
    const total = inv.snapshot.totals.total;
    const credited = -creditedCents(state, inv);
    if (refundDueCents(state, inv) > 0) return 'refund_due';
    if (credited >= total && total > 0) return 'credited';
    const open = balanceCents(state, inv);
    if (open <= 0) return 'paid';
    if (inv.dueDate && inv.dueDate < today) return 'overdue';
    return paidCents(inv) > 0 ? 'partly_paid' : 'issued';
  }
  function outstandingCents(state, inv) {
    return Math.max(0, balanceCents(state, inv));
  }
  // Paid more than the invoice is now worth (a credit note after payment): owed back to the client.
  function refundDueCents(state, inv) {
    return Math.max(0, -balanceCents(state, inv));
  }

  // What a downloaded PDF of an issued invoice shows in its payment box: the amount still due (with a QR code
  // for that amount), "Paid on <date>" once fully paid, or nothing when nothing is due and nothing was paid
  // (fully credited). Drafts and credit notes: {} (the PDF shows the document's own total, as before).
  function pdfPayment(state, inv) {
    if (!inv.number || inv.kind === 'credit_note') return {};
    const due = outstandingCents(state, inv);
    if (due > 0) return { amountDue: due };
    if (paidCents(inv) > 0) return { amountDue: 0, paidOn: lastPaymentDate(inv) };
    return { amountDue: 0 };
  }
  // The payment box of the PDF from a snapshot and pdfPayment()'s options:
  // { kind: 'due', amount, remaining, qr } | { kind: 'paid', paidOn } | { kind: 'none' }.
  function paymentBlock(snap, { draft = false, amountDue, paidOn } = {}) {
    if (snap.kind === 'credit_note' || snap.kind === 'quote') return { kind: 'none' };
    if (paidOn && !draft) return { kind: 'paid', paidOn };
    const amount = amountDue == null ? snap.totals.total : amountDue;
    if (!snap.issuer.iban || !(amount > 0)) return { kind: 'none' };
    return { kind: 'due', amount, remaining: amount !== snap.totals.total, qr: !draft && !!qrKind(snap) };
  }

  // ---------- validation ----------
  function ibanValid(iban) {
    const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    let m = 0;
    for (const ch of r) m = (m * 10 + Number(ch)) % 97;
    return m === 1;
  }
  // Slovenian tax number (davčna številka): 8 digits, mod-11 check digit.
  function siTaxNumberValid(v) {
    const s = String(v || '').replace(/^SI/i, '').replace(/\s+/g, '');
    if (!/^[1-9]\d{7}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += Number(s[i]) * (8 - i);
    let check = 11 - (sum % 11);
    if (check === 10) return false; // not issued
    if (check === 11) check = 0;
    return check === Number(s[7]);
  }
  function vatIdLooksValid(v) {
    const s = String(v || '').replace(/[\s.-]+/g, '').toUpperCase();
    if (s.startsWith('SI')) return siTaxNumberValid(s);
    return /^(EL|[A-Z]{2})[0-9A-Z]{2,13}$/.test(s);
  }

  // Everything that must be true before a number is assigned. Returns a list of messages.
  function issueProblems(state, doc, issueDate) {
    const p = [];
    const s = state.settings;
    const client = state.clients.find((c) => c.id === doc.clientId);
    const t = treatmentOf(doc);
    if (!s.companyName || !s.address || !s.postalCity) p.push('Company name and full address (Settings)');
    if (s.vatRegistered && !vatIdLooksValid(s.vatId)) p.push('A valid VAT ID (ID za DDV) for your company (Settings)');
    if (!s.vatRegistered && !siTaxNumberValid(s.taxNumber)) p.push('A valid tax number (davčna številka) for your company (Settings)');
    if (doc.kind !== 'credit_note' && !ibanValid(s.iban)) p.push('A valid IBAN for payment (Settings)');
    if (!client) p.push('A client');
    else {
      if (!client.name || !client.address || !client.postalCity) p.push('Client name and full address');
      if (s.vatRegistered && t.buyerVatId && !vatIdLooksValid(client.vatId)) p.push(`The client's VAT ID (required for "${t.label}")`);
      if (t.eu && client.country && (!EU.has(client.country) || client.country === 'SI')) p.push('An EU treatment needs a client in another EU country');
    }
    if (!(doc.lines || []).length) p.push('At least one line');
    if ((doc.lines || []).some((l) => !String(l.description || '').trim())) p.push('A description on every line');
    if ((doc.lines || []).some((l) => !(Number(l.qty) > 0) && doc.kind !== 'credit_note')) p.push('A quantity above zero on every line');
    if (!doc.supplyFrom) p.push('The date of supply or service period');
    if (!issueDate) p.push('An issue date');
    const year = Number((issueDate || '').slice(0, 4));
    const last = lastIssueDate(state, year);
    if (issueDate && last && issueDate < last) p.push(`An issue date on or after ${dmy(last)}, the last issued document of ${year} (numbers must follow dates)`);
    if (issueDate && issueDate > todayIso()) p.push('An issue date that is not in the future');
    if (doc.kind === 'credit_note') {
      const orig = state.invoices.find((i) => i.id === doc.creditOf);
      if (!orig || !orig.number) p.push('A reference to an issued original invoice');
      const tot = computeTotals(doc, s).total;
      if (!(tot < 0)) p.push('A negative total (a credit note reduces the original invoice)');
      if (orig && orig.number && -tot > outstandingCreditable(state, orig)) p.push('A credit no larger than what is still creditable on the original');
    }
    return p;
  }
  function outstandingCreditable(state, orig) {
    return orig.snapshot.totals.total + creditedCents(state, orig);
  }

  // Frozen copy of everything printed on the document. Never changes after issue.
  function buildSnapshot(state, doc, { issueDate, seq }) {
    const s = state.settings;
    const client = state.clients.find((c) => c.id === doc.clientId);
    const lang = doc.lang || client.lang || 'sl';
    const year = Number(issueDate.slice(0, 4));
    const totals = computeTotals(doc, s);
    const orig = doc.kind === 'credit_note' ? state.invoices.find((i) => i.id === doc.creditOf) : null;
    return {
      kind: doc.kind || 'invoice',
      number: formatNumber(s.numberPrefix, year, seq),
      issueDate,
      supplyFrom: doc.supplyFrom,
      supplyTo: doc.supplyTo || doc.supplyFrom,
      dueDate: doc.kind === 'credit_note' ? null : doc.dueDate,
      reference: doc.kind === 'credit_note' ? null : paymentReference(year, seq),
      lang,
      currency: 'EUR',
      treatment: doc.treatment,
      issuer: {
        name: s.companyName, address: s.address, postalCity: s.postalCity, country: 'SI',
        vatRegistered: !!s.vatRegistered, vatId: s.vatRegistered ? normVatId(s.vatId) : '',
        taxNumber: s.taxNumber || '', registrationNumber: s.registrationNumber || '',
        court: s.court || '', shareCapital: s.shareCapital || '',
        iban: (s.iban || '').replace(/\s+/g, '').toUpperCase(), bic: s.bic || '', bank: s.bank || '',
        email: s.email || '', phone: s.phone || '', web: s.web || '',
      },
      customer: {
        name: client.name, address: client.address, postalCity: client.postalCity, country: client.country || 'SI',
        vatId: normVatId(client.vatId), taxNumber: client.taxNumber || '', email: client.email || '',
      },
      lines: totals.lines.map((l) => ({ description: l.description, qty: Number(l.qty), unit: l.unit || '',
        unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) || 0, rate: l.rate, net: l.net })),
      totals: { byRate: totals.byRate, net: totals.net, vat: totals.vat, total: totals.total },
      clauses: clausesFor(doc, s, lang),
      creditOf: orig ? { number: orig.number, issueDate: orig.issueDate } : null,
      note: doc.note || '',
      footer: s.footer || '',
    };
  }
  const normVatId = (v) => String(v || '').replace(/[\s.-]+/g, '').toUpperCase();

  // Give a draft (already merged into state.invoices) the next number of its year and freeze it.
  // The caller holds the lock and has checked issueProblems(). Returns the snapshot.
  function issueDoc(state, doc, issueDate, issuedAt = new Date().toISOString()) {
    const year = Number(issueDate.slice(0, 4));
    const seq = nextSeq(state, year);
    if (doc.kind !== 'credit_note') doc.dueDate = addDays(issueDate, doc.paymentDays || 0);
    const snap = buildSnapshot(state, doc, { issueDate, seq });
    Object.assign(doc, { number: snap.number, year, seq, issueDate, reference: snap.reference, snapshot: snap, issuedAt });
    state.counters[String(year)] = seq;
    return snap;
  }

  // Numbering rules (ZDDV-1 Art. 82(2)): per year 1, 2, 3 … with no gaps, no number twice, counter = last number.
  function numberingProblems(state) {
    const problems = [];
    const byYear = {};
    for (const i of issuedDocs(state)) (byYear[i.year] = byYear[i.year] || []).push(i.seq);
    for (const [y, seqs] of Object.entries(byYear)) {
      seqs.sort((a, b) => a - b);
      for (let k = 1; k <= seqs[seqs.length - 1]; k++) if (!seqs.includes(k)) problems.push(`${y}: number ${k} is missing`);
      if (new Set(seqs).size !== seqs.length) problems.push(`${y}: a number is used twice`);
      if (((state.counters || {})[y] || 0) !== seqs[seqs.length - 1]) problems.push(`${y}: counter ${(state.counters || {})[y]} differs from the last number ${seqs[seqs.length - 1]}`);
    }
    return problems;
  }

  // Replacing copy `from` with copy `to` (a cloud copy, a backup): which issued documents of `from` would be lost?
  // A document is lost when `to` has no document with its id and number. `clash`: `to` has a different document
  // under the same number. `reused`: the number would be given again, because `to` already uses it for another
  // document or because `to`'s counter is below it (the next document issued there gets it).
  // Finalised quotes and proformas (state.quotes, own counter state.quoteCounters) are checked the same way.
  function compareCopies(from, to) {
    const lost = [];
    const check = (list, counterKey, fallbackKind) => {
      const issuedOf = (s) => (s && Array.isArray(s[list]) ? s[list].filter((i) => i && i.number) : []);
      const toDocs = issuedOf(to);
      const toById = new Map(toDocs.map((i) => [i.id, i]));
      const toByNumber = new Map(toDocs.map((i) => [i.number, i]));
      const counters = (to && to[counterKey]) || {};
      for (const d of issuedOf(from)) {
        const same = toById.get(d.id);
        if (same && same.number === d.number) continue;
        const other = toByNumber.get(d.number);
        const clash = !!(other && other.id !== d.id);
        const year = d.year || Number(String(d.issueDate || '').slice(0, 4));
        const reused = clash || !(Number(d.seq) <= (Number(counters[String(year)]) || 0));
        lost.push({
          id: d.id, number: d.number, kind: d.kind || fallbackKind, issueDate: d.issueDate || '',
          customer: (d.snapshot && d.snapshot.customer && d.snapshot.customer.name) || '',
          total: (d.snapshot && d.snapshot.totals && d.snapshot.totals.total) || 0, clash, reused,
        });
      }
    };
    check('invoices', 'counters', 'invoice');
    check('quotes', 'quoteCounters', 'quote');
    lost.sort((a, b) => String(a.number).localeCompare(String(b.number)));
    return { lost, reused: lost.filter((l) => l.reused) };
  }
  const lossLine = (l) => `${l.number} · ${l.customer || '?'} · ${eur(l.total)}${l.clash ? ' · the other copy has a different document with this number' : ''}`;
  // For the sync conflict dialog (StratumSync.attach describeLoss): one short line per issued document lost.
  function describeLoss(fromData, toData) {
    return compareCopies(fromData, toData).lost.map(lossLine);
  }

  // ---------- billing runs (retainers + unbilled work), as in Alphasyn Billing ----------
  // A run for period P (YYYY-MM) bills each active contract's retainer for P (advance) or P−1
  // (arrears), plus every unbilled billable work entry dated up to the end of P−1.
  function planRun(state, period) {
    const prev = prevMonth(period);
    const endPrev = lastDayOfMonth(prev);
    const rate = Number(state.settings.defaultVatRate ?? 22);
    const plans = [];
    for (const client of state.clients) {
      const lang = (client.lang || state.settings.lang) === 'en' ? 'en' : 'sl';
      const contracts = state.contracts.filter((k) => k.clientId === client.id);
      const lines = [];
      const contractIds = [];
      for (const k of contracts) {
        const billedMonth = k.timing === 'arrears' ? prev : period;
        const active = (!k.start || k.start <= lastDayOfMonth(billedMonth)) && (!k.end || k.end >= `${billedMonth}-01`);
        if (active && Number(k.monthlyFee) > 0) {
          // English clients get the contract's English title (if set) and English units.
          const title = (lang === 'en' && k.titleEn) || k.title || (lang === 'en' ? 'Monthly retainer' : 'Mesečni pavšal');
          lines.push({ description: `${title} – ${billedMonth}`, qty: 1, unit: unitFor('month', lang), unitPrice: Number(k.monthlyFee), discountPct: 0, vatRate: rate, source: { contractId: k.id, month: billedMonth } });
          contractIds.push(k.id);
        }
      }
      const work = state.work.filter((w) => w.clientId === client.id && w.billable && !w.invoiceId && w.date <= endPrev);
      for (const w of work) {
        const fixed = w.mode === 'fixed';
        lines.push({ description: `${w.description} (${dmy(w.date)})`, qty: fixed ? 1 : Number(w.hours), unit: unitFor(fixed ? 'piece' : 'hour', lang), unitPrice: fixed ? Number(w.amount) : Number(w.rate), discountPct: 0, vatRate: rate, source: { workId: w.id } });
      }
      if (!lines.length) continue;
      const done = state.runs.some((r) => r.clientId === client.id && r.period === period);
      plans.push({ client, lines, contractIds, done });
    }
    return plans;
  }

  // ---------- reports ----------
  // Ledger of issued documents (KIR-style) for a period: one row per document.
  function kirRows(state, from, to) {
    return issuedDocs(state)
      .filter((i) => i.issueDate >= from && i.issueDate <= to)
      .sort((a, b) => (a.year - b.year) || (a.seq - b.seq))
      .map((i) => {
        const s = i.snapshot;
        const t = TREATMENTS[s.treatment] || TREATMENTS.domestic;
        const at = (r) => s.totals.byRate.filter((b) => b.rate === r).reduce((a, b) => ({ base: a.base + b.base, vat: a.vat + b.vat }), { base: 0, vat: 0 });
        const r22 = at(22), r95 = at(9.5), r5 = at(5);
        const zero = s.totals.byRate.filter((b) => b.rate === 0).reduce((a, b) => a + b.base, 0);
        const kind = s.issuer.vatRegistered ? (t.kir || 'domestic') : 'not_registered';
        return {
          number: s.number, kind: s.kind === 'credit_note' ? 'Dobropis' : 'Račun', creditOf: s.creditOf ? s.creditOf.number : '',
          issueDate: s.issueDate, supplyDate: s.supplyTo || s.supplyFrom, customer: s.customer.name,
          customerAddress: `${s.customer.address}, ${s.customer.postalCity}`, country: s.customer.country, vatId: s.customer.vatId,
          total: s.totals.total, base22: r22.base, vat22: r22.vat, base95: r95.base, vat95: r95.vat, base5: r5.base, vat5: r5.vat,
          euGoods: kind === 'eu_goods' ? zero : 0, euServices: kind === 'eu_services' ? zero : 0,
          exportGoods: kind === 'export' ? zero : 0, outsideSi: kind === 'outside_si' ? zero : 0,
          domesticRc: kind === 'domestic_rc' ? zero : 0, notRegistered: kind === 'not_registered' ? zero : 0,
          treatment: t.label,
        };
      });
  }
  const KIR_COLUMNS = [
    ['number', 'Številka dokumenta'], ['kind', 'Vrsta'], ['creditOf', 'Sklic na račun'], ['issueDate', 'Datum izdaje'],
    ['supplyDate', 'Datum dobave'], ['customer', 'Kupec'], ['customerAddress', 'Naslov'], ['country', 'Država'],
    ['vatId', 'ID za DDV kupca'], ['total', 'Vrednost z DDV'], ['base22', 'Osnova 22 %'], ['vat22', 'DDV 22 %'],
    ['base95', 'Osnova 9,5 %'], ['vat95', 'DDV 9,5 %'], ['base5', 'Osnova 5 %'], ['vat5', 'DDV 5 %'],
    ['euGoods', 'Dobave blaga v EU (46. člen)'], ['euServices', 'Storitve v EU (obrnjena DO)'],
    ['exportGoods', 'Izvoz blaga (52. člen)'], ['outsideSi', 'Storitve – kraj izven SI'],
    ['domesticRc', 'Obrnjena DO v SI (76.a)'], ['notRegistered', 'Brez DDV (94. člen)'], ['treatment', 'Obravnava'],
  ];
  const MONEY_KEYS = new Set(['total', 'base22', 'vat22', 'base95', 'vat95', 'base5', 'vat5', 'euGoods', 'euServices', 'exportGoods', 'outsideSi', 'domesticRc', 'notRegistered']);

  // Recapitulative statement (RP-O) helper: EU supplies per customer VAT ID and month.
  function rpoRows(state, ym) {
    const map = new Map();
    for (const i of issuedDocs(state)) {
      const s = i.snapshot;
      const t = TREATMENTS[s.treatment];
      if (!t || !t.rpo || monthOf(s.issueDate) !== ym || !s.issuer.vatRegistered) continue;
      const key = `${s.customer.vatId}|${t.rpo}`;
      const r = map.get(key) || { vatId: s.customer.vatId, country: s.customer.country, customer: s.customer.name, type: t.rpo === 'goods' ? 'Blago' : 'Storitve', amount: 0 };
      r.amount += s.totals.net;
      map.set(key, r);
    }
    return [...map.values()].sort((a, b) => a.vatId.localeCompare(b.vatId));
  }

  function toCsv(columns, rows, moneyKeys = new Set()) {
    const cell = (v) => {
      const s = String(v ?? '');
      return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = columns.map(([, label]) => cell(label)).join(';');
    const body = rows.map((r) => columns.map(([k]) => cell(moneyKeys.has(k) ? plainNumber(r[k]) : r[k])).join(';'));
    return '﻿' + [head, ...body].join('\r\n') + '\r\n';
  }

  // ---------- payment QR codes (ported from Alphasyn Billing server/invoice.js) ----------
  const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const ddmmyyyy = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

  // UPN QR (ZBS): 19 LF-terminated fields + 3-digit checksum (character count of the first 19
  // fields with their LFs). Encode as ISO-8859-2, QR version 15, ECC level M.
  function upnQrText(snap, amountCents) {
    const c = snap.customer, s = snap.issuer;
    const fields = ['UPNQR', '', '', '', '', clip(c.name, 33), clip(c.address, 33), clip(c.postalCity, 33),
      String(amountCents).padStart(11, '0'), '', '', 'SCVE', clip(`${snap.kind === 'proforma' ? 'Predračun' : 'Račun'} ${snap.number}`, 42), ddmmyyyy(snap.dueDate),
      s.iban, snap.reference.replace(/\s+/g, ''), clip(s.name, 33), clip(s.address, 33), clip(s.postalCity, 33)];
    const body = fields.map((f) => `${f}\n`).join('');
    return `${body}${String(body.length).padStart(3, '0')}\n`;
  }
  // EPC069-12 SEPA credit transfer QR (version 002, UTF-8), for payers in other EU countries.
  function epcQrText(snap, amountCents) {
    const s = snap.issuer;
    return ['BCD', '002', '1', 'SCT', s.bic || '', clip(s.name, 70), s.iban, `EUR${(amountCents / 100).toFixed(2)}`, '', '',
      clip(`${snap.kind === 'proforma' ? 'Proforma' : 'Invoice'} ${snap.number} ${snap.reference}`, 140)].join('\n');
  }
  function qrKind(snap) {
    if (snap.kind === 'credit_note' || snap.kind === 'quote' || !snap.issuer.iban || !(snap.totals.total > 0)) return null;
    if (snap.customer.country === 'SI') return 'upn';
    return EU.has(snap.customer.country) ? 'epc' : null;
  }
  let latin2 = null;
  function toLatin2Bytes(str) {
    if (!latin2) {
      latin2 = new Map();
      const dec = new TextDecoder('iso-8859-2');
      for (let b = 0xa0; b <= 0xff; b++) latin2.set(dec.decode(Uint8Array.of(b)), b);
    }
    const out = [];
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code < 0x80) out.push(code);
      else out.push(latin2.get(ch) ?? 0x3f); // '?' for characters outside ISO-8859-2
    }
    return out;
  }

  // ---------- languages: country names and units, so an English invoice reads English ----------
  const COUNTRY_NAMES = {
    sl: { SI: 'Slovenija', HR: 'Hrvaška', AT: 'Avstrija', IT: 'Italija', DE: 'Nemčija', HU: 'Madžarska', CZ: 'Češka', SK: 'Slovaška', PL: 'Poljska',
      FR: 'Francija', NL: 'Nizozemska', BE: 'Belgija', IE: 'Irska', ES: 'Španija', PT: 'Portugalska', SE: 'Švedska', DK: 'Danska', FI: 'Finska',
      LU: 'Luksemburg', RO: 'Romunija', BG: 'Bolgarija', GR: 'Grčija', CY: 'Ciper', MT: 'Malta', EE: 'Estonija', LV: 'Latvija', LT: 'Litva',
      GB: 'Združeno kraljestvo', CH: 'Švica', NO: 'Norveška', RS: 'Srbija', BA: 'Bosna in Hercegovina', ME: 'Črna gora', MK: 'Severna Makedonija',
      AL: 'Albanija', US: 'Združene države Amerike', CA: 'Kanada', AU: 'Avstralija' },
    en: { SI: 'Slovenia', HR: 'Croatia', AT: 'Austria', IT: 'Italy', DE: 'Germany', HU: 'Hungary', CZ: 'Czechia', SK: 'Slovakia', PL: 'Poland',
      FR: 'France', NL: 'Netherlands', BE: 'Belgium', IE: 'Ireland', ES: 'Spain', PT: 'Portugal', SE: 'Sweden', DK: 'Denmark', FI: 'Finland',
      LU: 'Luxembourg', RO: 'Romania', BG: 'Bulgaria', GR: 'Greece', CY: 'Cyprus', MT: 'Malta', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania',
      GB: 'United Kingdom', CH: 'Switzerland', NO: 'Norway', RS: 'Serbia', BA: 'Bosnia and Herzegovina', ME: 'Montenegro', MK: 'North Macedonia',
      AL: 'Albania', US: 'United States', CA: 'Canada', AU: 'Australia' },
  };
  const countryName = (code, lang) => ((COUNTRY_NAMES[lang] || COUNTRY_NAMES.sl)[code] || code || '');
  // Units the app writes itself, per language. Lines keep what was typed; the English PDF shows the English word for
  // the common Slovenian abbreviations (the frozen snapshot is not changed).
  const UNITS = { sl: { piece: 'kos', hour: 'ur', month: 'mes.' }, en: { piece: 'pc', hour: 'h', month: 'month' } };
  const UNIT_SL_EN = { 'kos': 'pc', 'kos.': 'pc', 'kom': 'pc', 'kom.': 'pc', 'ur': 'h', 'ura': 'h', 'ure': 'h', 'ur.': 'h', 'mes': 'month', 'mes.': 'month',
    'mesec': 'month', 'dan': 'day', 'dni': 'days', 'teden': 'week', 'leto': 'year', 'pavšal': 'lump sum', 'projekt': 'project', 'storitev': 'service', 'kpl': 'set', 'kpl.': 'set' };
  const UNIT_EN_SL = { 'pc': 'kos', 'pcs': 'kos', 'piece': 'kos', 'h': 'ur', 'hour': 'ur', 'hours': 'ur', 'hrs': 'ur', 'month': 'mes.', 'months': 'mes.', 'day': 'dan', 'days': 'dni', 'week': 'teden', 'year': 'leto', 'lump sum': 'pavšal', 'project': 'projekt', 'service': 'storitev', 'set': 'kpl' };
  const unitFor = (kind, lang) => (UNITS[lang] || UNITS.sl)[kind];
  const unitLabel = (unit, lang) => (lang === 'en' ? (UNIT_SL_EN[String(unit || '').trim().toLowerCase()] || unit || '') : (unit || ''));
  // A draft switched to the other language: translate the units the app knows, leave anything else as typed.
  function translateUnit(unit, toLang) {
    const k = String(unit || '').trim().toLowerCase();
    if (toLang === 'en') return UNIT_SL_EN[k] || unit;
    if (toLang === 'sl') return UNIT_EN_SL[k] || unit;
    return unit;
  }

  // ---------- quotes and proforma invoices (ponudba / predračun) ----------
  // Their own collection (state.quotes), their own counter (state.quoteCounters) and their own prefix, so they can never
  // take or skip an invoice number. Neither is an invoice under ZDDV-1 (no VAT is accounted on them); a proforma that is
  // paid before the supply makes VAT due on the payment and needs an advance-payment invoice (ZDDV-1 Art. 33 and 81 –
  // confirm the handling with your accountant).
  const QUOTE_KINDS = { quote: { sl: 'Ponudba', en: 'Quote' }, proforma: { sl: 'Predračun', en: 'Proforma invoice' } };
  const quotePrefix = (settings) => String((settings && settings.quotePrefix) || 'PR-');
  const quoteNextSeq = (state, year) => (((state.quoteCounters || {})[String(year)]) || 0) + 1;
  // Model SI00 with a first part 99, so a proforma's reference never looks like an invoice's (SI00 2026-0001).
  const proformaReference = (year, seq) => `SI00 99-${year}-${pad(seq, 4)}`;
  function quoteProblems(state, q, issueDate) {
    const p = [];
    const s = state.settings;
    const client = state.clients.find((c) => c.id === q.clientId);
    if (!s.companyName || !s.address || !s.postalCity) p.push('Company name and full address (Settings)');
    if (q.kind === 'proforma' && !ibanValid(s.iban)) p.push('A valid IBAN for payment (Settings)');
    if (quotePrefix(s) === String(s.numberPrefix || '')) p.push('A quote number prefix that differs from the invoice prefix (Settings)');
    if (!client) p.push('A client');
    else if (!client.name || !client.address || !client.postalCity) p.push('Client name and full address');
    if (!(q.lines || []).length) p.push('At least one line');
    if ((q.lines || []).some((l) => !String(l.description || '').trim())) p.push('A description on every line');
    if ((q.lines || []).some((l) => !(Number(l.qty) > 0))) p.push('A quantity above zero on every line');
    if (!issueDate) p.push('A date');
    if (issueDate && issueDate > todayIso()) p.push('A date that is not in the future');
    return p;
  }
  function buildQuoteSnapshot(state, q, { issueDate, seq }) {
    const year = Number(issueDate.slice(0, 4));
    const base = buildSnapshot(state, { ...q, kind: 'invoice', supplyFrom: q.supplyFrom || '', supplyTo: q.supplyTo || '' }, { issueDate, seq });
    const kind = q.kind === 'proforma' ? 'proforma' : 'quote';
    return {
      ...base, kind, number: formatNumber(quotePrefix(state.settings), year, seq),
      supplyFrom: q.supplyFrom || '', supplyTo: q.supplyTo || q.supplyFrom || '',
      validUntil: addDays(issueDate, Number(q.validDays ?? 30)),
      dueDate: kind === 'proforma' ? addDays(issueDate, Number(q.paymentDays || 0)) : null,
      reference: kind === 'proforma' ? proformaReference(year, seq) : null, creditOf: null,
    };
  }
  // Number and freeze a quote draft (merged into state.quotes by the caller, who holds the lock).
  function issueQuote(state, q, issueDate, issuedAt = new Date().toISOString()) {
    if (!state.quoteCounters) state.quoteCounters = {};
    const year = Number(issueDate.slice(0, 4));
    const seq = quoteNextSeq(state, year);
    const snap = buildQuoteSnapshot(state, q, { issueDate, seq });
    Object.assign(q, { number: snap.number, year, seq, issueDate, snapshot: snap, issuedAt });
    state.quoteCounters[String(year)] = seq;
    return snap;
  }
  // draft · open · expired · accepted · declined · invoiced (an invoice draft or invoice was made from it)
  function quoteStatus(state, q, today = todayIso()) {
    if (!q.number) return 'draft';
    if (q.invoiceId && state.invoices.some((i) => i.id === q.invoiceId)) return 'invoiced';
    if (q.decision === 'accepted') return 'accepted';
    if (q.decision === 'declined') return 'declined';
    if (q.snapshot && q.snapshot.validUntil && q.snapshot.validUntil < today) return 'expired';
    return 'open';
  }
  // Same rules as invoice numbering, for the quote series only.
  function quoteNumberingProblems(state) {
    const problems = [];
    const byYear = {};
    for (const q of (state.quotes || []).filter((x) => x.number)) (byYear[q.year] = byYear[q.year] || []).push(q.seq);
    for (const [y, seqs] of Object.entries(byYear)) {
      seqs.sort((a, b) => a - b);
      for (let k = 1; k <= seqs[seqs.length - 1]; k++) if (!seqs.includes(k)) problems.push(`Quotes ${y}: number ${k} is missing`);
      if (new Set(seqs).size !== seqs.length) problems.push(`Quotes ${y}: a number is used twice`);
    }
    return problems;
  }
  // The draft invoice "Convert to invoice" makes: same client, treatment, language and lines; dates are set when issuing.
  function invoiceFromQuote(q, { today = todayIso(), defaultVatRate = 22 } = {}) {
    const src = q.snapshot || q;
    const lang = src.lang || q.lang || 'sl';
    const what = q.kind === 'proforma' ? (lang === 'en' ? 'proforma invoice' : 'predračunu') : (lang === 'en' ? 'quote' : 'ponudbi');
    return {
      kind: 'invoice', clientId: q.clientId, treatment: src.treatment || q.treatment || 'domestic', lang,
      supplyFrom: q.supplyFrom || today, supplyTo: q.supplyTo || '', paymentDays: Number(q.paymentDays ?? 15),
      note: lang === 'en' ? `As per ${what} ${q.number}` : `Po ${what} ${q.number}`, fromQuote: q.id,
      lines: (q.lines || []).map((l) => ({ description: l.description, qty: Number(l.qty), unit: l.unit || '', unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct) || 0, vatRate: Number(l.vatRate ?? defaultVatRate) })),
    };
  }

  // ---------- payment reminders ----------
  const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 864e5);
  const fillT = (tpl, v) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? m : v[k]));
  const REMINDER_T = {
    sl: {
      titles: ['Obvestilo o zapadlem računu', 'Opomin'],
      salutation: 'Spoštovani,',
      intro: [
        'pri pregledu odprtih postavk smo ugotovili, da spodaj navedeni račun še ni poravnan, čeprav je rok plačila že potekel. Verjamemo, da gre za spregled, zato vas prijazno prosimo, da odprti znesek poravnate najpozneje do {deadline}.',
        'ugotavljamo, da do danes nismo prejeli plačila spodaj navedenega zapadlega računa. Prosimo, da odprti znesek poravnate najpozneje do {deadline}.',
      ],
      introAfter: 'kljub našemu obvestilu z dne {last} spodaj navedeni račun še vedno ni poravnan. Prosimo, da odprti znesek poravnate najpozneje do {deadline}.',
      interest: 'Pridržujemo si pravico do obračuna zakonskih zamudnih obresti od dneva zapadlosti do plačila.',
      pay: 'Znesek {amount} nakažite na transakcijski račun {iban}, sklic {reference}.',
      closing: 'Če ste račun medtem že poravnali, se vam zahvaljujemo in vas prosimo, da ta dopis štejete za brezpredmeten.',
      contact: 'Za vprašanja smo vam na voljo na {contact}.',
      signoff: 'Lep pozdrav,',
      th: { no: 'Račun', issued: 'Datum izdaje', due: 'Zapadlost', total: 'Znesek', paid: 'Plačano', open: 'Odprto', late: 'Dni zamude' },
      totalOpen: 'Skupaj odprto', payTitle: 'Podatki za plačilo', payBy: 'Rok plačila', ref: 'Sklic', placeDate: '{place}, {date}',
      subject: '{title} – račun {number}', mailIntro: 'v prilogi vam pošiljamo {title} za račun {number} z dne {issued}. Odprti znesek {amount} je zapadel {due}.',
      mailPay: 'Prosimo, da ga poravnate najpozneje do {deadline} na IBAN {iban}, sklic {reference}.',
    },
    en: {
      titles: ['Payment reminder', 'Reminder'],
      salutation: 'Dear Sir or Madam,',
      intro: [
        'Our records show that the invoice listed below is still unpaid, although its due date has passed. We assume this is an oversight and kindly ask you to pay the open amount by {deadline} at the latest.',
        'We have not yet received payment of the overdue invoice listed below. Please pay the open amount by {deadline} at the latest.',
      ],
      introAfter: 'Despite our reminder of {last}, the invoice listed below is still unpaid. Please pay the open amount by {deadline} at the latest.',
      interest: 'We reserve the right to charge statutory default interest from the due date until payment.',
      pay: 'Please transfer {amount} to IBAN {iban}, quoting reference {reference}.',
      closing: 'If you have already paid, thank you, and please disregard this letter.',
      contact: 'If you have any questions, please contact us at {contact}.',
      signoff: 'Kind regards,',
      th: { no: 'Invoice', issued: 'Issue date', due: 'Due date', total: 'Amount', paid: 'Paid', open: 'Open', late: 'Days late' },
      totalOpen: 'Total open', payTitle: 'Payment details', payBy: 'Pay by', ref: 'Reference', placeDate: '{place}, {date}',
      subject: '{title} – invoice {number}', mailIntro: 'Please find attached a {lowerTitle} for invoice {number} of {issued}. The open amount of {amount} was due on {due}.',
      mailPay: 'Please pay it by {deadline} to IBAN {iban}, reference {reference}.',
    },
  };
  const ibanGroups = (s) => String(s || '').replace(/(.{4})(?=.)/g, '$1 ');
  // Everything a reminder letter shows, for one overdue invoice. stage 0 = friendly reminder, 1 = reminder (opomin).
  function reminderLetter(state, inv, { lang, stage = 0, today = todayIso(), deadline } = {}) {
    const snap = inv.snapshot;
    const L = lang || snap.lang || 'sl';
    const t = REMINDER_T[L] || REMINDER_T.sl;
    const open = outstandingCents(state, inv);
    const pay = deadline || addDays(today, 8);
    const last = (inv.reminders || []).map((r) => r.date).filter(Boolean).sort().pop() || null;
    const v = { deadline: dmy(pay), last: last ? dmy(last) : '' };
    const st = stage ? 1 : 0;
    const intro = fillT(st === 1 && last ? t.introAfter : t.intro[st], v);
    const contact = [snap.issuer.email, snap.issuer.phone].filter(Boolean).join(L === 'en' ? ' or ' : ' ali ');
    const paragraphs = [`${t.salutation}`, intro];
    if (st === 1) paragraphs.push(t.interest);
    paragraphs.push(fillT(t.pay, { amount: eur(open), iban: ibanGroups(snap.issuer.iban), reference: snap.reference }));
    paragraphs.push(t.closing);
    if (contact) paragraphs.push(fillT(t.contact, { contact }));
    const place = String(snap.issuer.postalCity || '').replace(/^\s*[\w-]*\d[\w-]*\s+/, '') || snap.issuer.postalCity || '';
    const title = t.titles[st];
    return {
      lang: L, stage: st, title, date: today, deadline: pay, place, placeDate: fillT(t.placeDate, { place, date: dmy(today) }),
      issuer: snap.issuer, customer: snap.customer, paragraphs, signoff: t.signoff, th: t.th, totalOpenLabel: t.totalOpen,
      payTitle: t.payTitle, payByLabel: t.payBy, refLabel: t.ref,
      rows: [{ number: snap.number, issueDate: snap.issueDate, dueDate: snap.dueDate, total: snap.totals.total + creditedCents(state, inv),
        paid: paidCents(inv) - refundedCents(inv), open, daysLate: Math.max(0, daysBetween(snap.dueDate, today)) }],
      open, reference: snap.reference, iban: snap.issuer.iban,
      subject: fillT(t.subject, { title, number: snap.number }),
      mailText: [t.salutation, '', fillT(t.mailIntro, { title: title.toLowerCase(), lowerTitle: title.toLowerCase(), number: snap.number, issued: dmy(snap.issueDate), amount: eur(open), due: dmy(snap.dueDate) }),
        fillT(t.mailPay, { deadline: dmy(pay), iban: ibanGroups(snap.issuer.iban), reference: snap.reference }), '', t.closing, '', t.signoff, snap.issuer.name].join('\n'),
    };
  }

  // ---------- e-mail file (.eml): a ready message with the PDF attached, opened by Outlook / Apple Mail ----------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
    }
    return out;
  }
  const utf8 = (s) => new TextEncoder().encode(String(s));
  const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
  // RFC 2047 encoded word for non-ASCII header text (subject, display names).
  const mimeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(utf8(s))}?=`);
  const mimeName = (s) => (/^[\x20-\x7e]*$/.test(s) ? `"${String(s).replace(/["\\]/g, '')}"` : mimeWord(s));
  // RFC 5322 / 2045–2049 multipart message. X-Unsent: 1 makes Outlook open it as a draft ready to send.
  function buildEml({ from, to, subject, text, attachments = [], date = new Date(), boundary } = {}) {
    const b = boundary || `=_billing_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const addr = (a) => (a && a.email ? (a.name ? `${mimeName(a.name)} <${a.email}>` : a.email) : '');
    const head = [
      'MIME-Version: 1.0', `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
      from && from.email ? `From: ${addr(from)}` : null, `To: ${addr(to) || ''}`,
      `Subject: ${mimeWord(subject || '')}`, 'X-Unsent: 1', `Content-Type: multipart/mixed; boundary="${b}"`,
    ].filter((x) => x !== null);
    const parts = [
      `--${b}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(base64(utf8(String(text || '').replace(/\r?\n/g, '\r\n')))),
    ];
    for (const a of attachments) {
      parts.push(`--${b}`, `Content-Type: ${a.type || 'application/octet-stream'}; name=${mimeName(a.name)}`, 'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename=${mimeName(a.name)}`, '', wrap76(base64(a.bytes)));
    }
    parts.push(`--${b}--`, '');
    return `${head.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
  }

  // ---------- integrity: canonical JSON for hashing ----------
  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }

  const api = {
    VAT_RATES, EU, TREATMENTS, SMALL_TAXPAYER_CLAUSE, KIR_COLUMNS, MONEY_KEYS,
    pad, isoDate, todayIso, addDays, dmy, monthOf, lastDayOfMonth, prevMonth, cents, eur, plainNumber,
    computeTotals, clausesFor, formatNumber, paymentReference, nextSeq, lastIssueDate, statusOf, outstandingCents,
    paidCents, creditedCents, outstandingCreditable, refundedCents, refundDueCents, balanceCents, lastPaymentDate,
    pdfPayment, paymentBlock, issueDoc, numberingProblems, compareCopies, describeLoss, lossLine, ibanValid, siTaxNumberValid, vatIdLooksValid, issueProblems,
    buildSnapshot, planRun, kirRows, rpoRows, toCsv, upnQrText, epcQrText, qrKind, toLatin2Bytes, canonical, normVatId,
    COUNTRY_NAMES, countryName, UNITS, unitFor, unitLabel, translateUnit,
    QUOTE_KINDS, quotePrefix, quoteNextSeq, proformaReference, quoteProblems, buildQuoteSnapshot, issueQuote, quoteStatus, quoteNumberingProblems, invoiceFromQuote,
    REMINDER_T, reminderLetter, daysBetween, base64, buildEml, mimeWord,
  };
  root.BillingCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
