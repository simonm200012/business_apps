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

  // Draft · Issued · Partly paid · Paid · Overdue · Credited (credit notes: Issued / Draft).
  function statusOf(state, inv, today = todayIso()) {
    if (!inv.number) return 'draft';
    if (inv.kind === 'credit_note') return 'issued';
    const total = inv.snapshot.totals.total;
    const credited = -creditedCents(state, inv);
    if (credited >= total && total > 0) return 'credited';
    const open = total - credited - paidCents(inv);
    if (open <= 0) return 'paid';
    if (inv.dueDate && inv.dueDate < today) return 'overdue';
    return paidCents(inv) > 0 ? 'partly_paid' : 'issued';
  }
  function outstandingCents(state, inv) {
    if (!inv.number || inv.kind === 'credit_note') return 0;
    return Math.max(0, inv.snapshot.totals.total + creditedCents(state, inv) - paidCents(inv));
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

  // ---------- billing runs (retainers + unbilled work), as in Alphasyn Billing ----------
  // A run for period P (YYYY-MM) bills each active contract's retainer for P (advance) or P−1
  // (arrears), plus every unbilled billable work entry dated up to the end of P−1.
  function planRun(state, period) {
    const prev = prevMonth(period);
    const endPrev = lastDayOfMonth(prev);
    const rate = Number(state.settings.defaultVatRate ?? 22);
    const plans = [];
    for (const client of state.clients) {
      const contracts = state.contracts.filter((k) => k.clientId === client.id);
      const lines = [];
      const contractIds = [];
      for (const k of contracts) {
        const billedMonth = k.timing === 'arrears' ? prev : period;
        const active = (!k.start || k.start <= lastDayOfMonth(billedMonth)) && (!k.end || k.end >= `${billedMonth}-01`);
        if (active && Number(k.monthlyFee) > 0) {
          lines.push({ description: `${k.title || 'Monthly retainer'} – ${billedMonth}`, qty: 1, unit: 'mes.', unitPrice: Number(k.monthlyFee), discountPct: 0, vatRate: rate, source: { contractId: k.id, month: billedMonth } });
          contractIds.push(k.id);
        }
      }
      const work = state.work.filter((w) => w.clientId === client.id && w.billable && !w.invoiceId && w.date <= endPrev);
      for (const w of work) {
        const fixed = w.mode === 'fixed';
        lines.push({ description: `${w.description} (${dmy(w.date)})`, qty: fixed ? 1 : Number(w.hours), unit: fixed ? 'kos' : 'ur', unitPrice: fixed ? Number(w.amount) : Number(w.rate), discountPct: 0, vatRate: rate, source: { workId: w.id } });
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
      String(amountCents).padStart(11, '0'), '', '', 'SCVE', clip(`Račun ${snap.number}`, 42), ddmmyyyy(snap.dueDate),
      s.iban, snap.reference.replace(/\s+/g, ''), clip(s.name, 33), clip(s.address, 33), clip(s.postalCity, 33)];
    const body = fields.map((f) => `${f}\n`).join('');
    return `${body}${String(body.length).padStart(3, '0')}\n`;
  }
  // EPC069-12 SEPA credit transfer QR (version 002, UTF-8), for payers in other EU countries.
  function epcQrText(snap, amountCents) {
    const s = snap.issuer;
    return ['BCD', '002', '1', 'SCT', s.bic || '', clip(s.name, 70), s.iban, `EUR${(amountCents / 100).toFixed(2)}`, '', '',
      clip(`Invoice ${snap.number} ${snap.reference}`, 140)].join('\n');
  }
  function qrKind(snap) {
    if (snap.kind === 'credit_note' || !snap.issuer.iban || !(snap.totals.total > 0)) return null;
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
    paidCents, creditedCents, outstandingCreditable, ibanValid, siTaxNumberValid, vatIdLooksValid, issueProblems,
    buildSnapshot, planRun, kirRows, rpoRows, toCsv, upnQrText, epcQrText, qrKind, toLatin2Bytes, canonical, normVatId,
  };
  root.BillingCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
