// Tests for site/billing/core.js (the rules behind Billing's real invoices). Run: node tools/tests/billing.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '../../site/billing/core.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// ---------- fixtures ----------
const SETTINGS = {
  companyName: 'Vzorec d.o.o.', address: 'Dunajska cesta 5', postalCity: '1000 Ljubljana', vatRegistered: true, vatId: 'SI12345679',
  taxNumber: '12345679', registrationNumber: '', court: '', shareCapital: '', iban: 'SI56191000000123438', bic: 'BSLJSI2X', bank: '',
  email: '', phone: '', web: '', numberPrefix: 'VZ-', paymentDays: 15, defaultVatRate: 22, lang: 'sl', footer: '',
};
let ids = 0;
const id = (p) => `${p}-${++ids}`;
function newState() {
  return {
    version: 1, settings: { ...SETTINGS }, counters: {}, contracts: [], work: [], invoices: [], runs: [], audit: [], meta: {},
    clients: [
      { id: 'lipa', name: 'Studio Lipa d.o.o.', address: 'Trubarjeva cesta 12', postalCity: '1000 Ljubljana', country: 'SI', vatId: 'SI23456787', treatment: 'domestic', lang: 'sl' },
      { id: 'bright', name: 'Brightline Analytics GmbH', address: 'Mariahilfer Straße 1', postalCity: '1060 Wien', country: 'AT', vatId: 'ATU99999999', treatment: 'eu_services', lang: 'en' },
      { id: 'nimbus', name: 'Nimbus Cloud, Inc.', address: '500 Market Street', postalCity: 'San Francisco', country: 'US', vatId: '', treatment: 'export_services', lang: 'en' },
    ],
  };
}
const line = (description, qty, unitPrice, vatRate = 22, discountPct = 0) => ({ description, qty, unit: 'kos', unitPrice, discountPct, vatRate });
function draft(state, clientId, lines, extra = {}) {
  const c = state.clients.find((x) => x.id === clientId);
  const d = { id: id('doc'), kind: 'invoice', clientId, treatment: c.treatment, lang: c.lang, supplyFrom: '2026-10-01', supplyTo: '', paymentDays: 15, note: '', lines, payments: [], ...extra };
  state.invoices.push(d);
  return d;
}
// What app.js issue() does inside the lock: check, then number and freeze.
function issue(state, doc, date) {
  const probs = C.issueProblems(state, doc, date);
  if (probs.length) throw new Error(probs.join('; '));
  return C.issueDoc(state, doc, date, `${date}T09:00:00.000Z`);
}
const pay = (doc, amount, date) => { doc.payments.push({ id: id('pay'), date, amount, method: 'bank_transfer', note: '' }); };
function creditNote(state, orig, lines, date) {
  const cn = draft(state, orig.clientId, lines, { kind: 'credit_note', creditOf: orig.id, treatment: orig.snapshot.treatment, paymentDays: 0 });
  issue(state, cn, date);
  return cn;
}

// ---------- numbering ----------
t('numbers are 1, 2, 3 … per year with the prefix, and restart each year', () => {
  const s = newState();
  const a = draft(s, 'lipa', [line('A', 1, 100)]);
  const b = draft(s, 'lipa', [line('B', 1, 100)]);
  const c = draft(s, 'lipa', [line('C', 1, 100)]);
  issue(s, a, '2025-12-30');
  issue(s, b, '2026-01-02');
  issue(s, c, '2026-01-02');
  assert.deepStrictEqual([a.number, b.number, c.number], ['VZ-2025-0001', 'VZ-2026-0001', 'VZ-2026-0002']);
  assert.deepStrictEqual(s.counters, { 2025: 1, 2026: 2 });
  assert.strictEqual(C.nextSeq(s, 2026), 3);
  assert.strictEqual(b.reference, 'SI00 2026-0001');
  assert.deepStrictEqual(C.numberingProblems(s), []);
});

t('many documents in a row are gap-free and unique', () => {
  const s = newState();
  const dates = ['2026-01-05', '2026-01-05', '2026-02-10', '2026-03-01', '2026-03-01', '2026-03-31', '2026-06-15', '2026-10-01'];
  for (const d of dates) issue(s, draft(s, 'lipa', [line('X', 1, 10)]), d);
  const nums = s.invoices.map((i) => i.number);
  assert.strictEqual(new Set(nums).size, nums.length);
  assert.deepStrictEqual(s.invoices.map((i) => i.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepStrictEqual(C.numberingProblems(s), []);
});

t('a number is refused for an issue date before the last issued one, or in the future', () => {
  const s = newState();
  issue(s, draft(s, 'lipa', [line('A', 1, 100)]), '2026-10-10');
  const b = draft(s, 'lipa', [line('B', 1, 100)]);
  assert.ok(C.issueProblems(s, b, '2026-10-09').some((p) => /on or after 10\. 10\. 2026/.test(p)));
  assert.ok(C.issueProblems(s, b, '2999-01-01').some((p) => /not in the future/.test(p)));
  assert.throws(() => issue(s, b, '2026-10-09'));
  assert.strictEqual(b.number, undefined);
  assert.strictEqual(s.counters['2026'], 1);
});

t('numbering problems: a gap, a duplicate and a wrong counter are found', () => {
  const s = newState();
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) issue(s, draft(s, 'lipa', [line('X', 1, 10)]), d);
  const gap = JSON.parse(JSON.stringify(s));
  gap.invoices.splice(1, 1);
  assert.deepStrictEqual(C.numberingProblems(gap), ['2026: number 2 is missing']);
  const dup = JSON.parse(JSON.stringify(s));
  dup.invoices[2].seq = 2;
  assert.ok(C.numberingProblems(dup).includes('2026: a number is used twice'));
  const ctr = JSON.parse(JSON.stringify(s));
  ctr.counters['2026'] = 5;
  assert.deepStrictEqual(C.numberingProblems(ctr), ['2026: counter 5 differs from the last number 3']);
});

// ---------- VAT ----------
t('VAT is rounded once per rate on the summed base, lines to the cent', () => {
  // 3 × 0,333 € = 0,999 → 1,00 €; discount 10 % of 19,99 = 17,991 → 17,99 €
  const tot = C.computeTotals({ treatment: 'domestic', lines: [line('a', 3, 0.333), line('b', 1, 19.99, 22, 10), line('c', 1, 10.05, 9.5)] }, SETTINGS);
  assert.deepStrictEqual(tot.lines.map((l) => l.net), [100, 1799, 1005]);
  assert.deepStrictEqual(tot.byRate.map((r) => [r.rate, r.base, r.vat]), [[22, 1899, 418], [9.5, 1005, 95]]); // 417,78 → 418; 95,475 → 95
  assert.strictEqual(tot.net, 2904);
  assert.strictEqual(tot.vat, 513);
  assert.strictEqual(tot.total, 3417);
});

t('per-rate rounding differs from per-line rounding where it should', () => {
  // three lines of 0,05 € at 22 %: per line 0,011 → 0,01 each (0,03), on the sum 0,15 × 22 % = 0,033 → 0,03
  const tot = C.computeTotals({ treatment: 'domestic', lines: [line('a', 1, 0.05), line('b', 1, 0.05), line('c', 1, 0.05)] }, SETTINGS);
  assert.strictEqual(tot.vat, 3);
  // 7 lines of 0,07 € at 22 %: per line 0,0154 → 0,02 each (0,14); on the sum 0,49 × 22 % = 0,1078 → 0,11
  const tot2 = C.computeTotals({ treatment: 'domestic', lines: Array.from({ length: 7 }, () => line('x', 1, 0.07)) }, SETTINGS);
  assert.strictEqual(tot2.vat, 11);
});

t('no Slovenian VAT on reverse charge / export, or when not VAT registered', () => {
  const eu = C.computeTotals({ treatment: 'eu_services', lines: [line('a', 2, 100)] }, SETTINGS);
  assert.deepStrictEqual([eu.vat, eu.total, eu.byRate[0].rate], [0, 20000, 0]);
  const small = C.computeTotals({ treatment: 'domestic', lines: [line('a', 2, 100)] }, { ...SETTINGS, vatRegistered: false });
  assert.deepStrictEqual([small.vat, small.total], [0, 20000]);
});

// ---------- open / paid / refund due ----------
t('outstanding, partly paid and paid', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('Pavšal', 1, 1000)]); // 1.220,00 €
  issue(s, inv, '2026-10-01');
  assert.strictEqual(inv.snapshot.totals.total, 122000);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-02'), 'issued');
  assert.strictEqual(C.statusOf(s, inv, '2026-10-17'), 'overdue');
  pay(inv, 22000, '2026-10-05');
  assert.strictEqual(C.outstandingCents(s, inv), 100000);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-06'), 'partly_paid');
  pay(inv, 100000, '2026-10-08');
  assert.strictEqual(C.outstandingCents(s, inv), 0);
  assert.strictEqual(C.refundDueCents(s, inv), 0);
  assert.strictEqual(C.statusOf(s, inv, '2026-12-01'), 'paid');
});

t('credit note on an unpaid invoice lowers what is due; full credit = Credited', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 1, 100), line('B', 1, 100)]); // 244,00 €
  issue(s, inv, '2026-10-01');
  creditNote(s, inv, [line('B', -1, 100)], '2026-10-02');
  assert.strictEqual(C.creditedCents(s, inv), -12200);
  assert.strictEqual(C.outstandingCents(s, inv), 12200);
  assert.strictEqual(C.outstandingCreditable(s, inv), 12200);
  creditNote(s, inv, [line('A', -1, 100)], '2026-10-03');
  assert.strictEqual(C.outstandingCents(s, inv), 0);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-04'), 'credited');
  assert.strictEqual(C.refundDueCents(s, inv), 0);
});

t('credit note on a paid invoice: Refund due, then Paid once the refund is recorded', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('Meni', 1, 450), line('Foto', 4, 55)]); // (450 + 220) × 1,22 = 817,40 €
  issue(s, inv, '2026-10-01');
  pay(inv, 81740, '2026-10-10');
  creditNote(s, inv, [line('Foto', -1, 55)], '2026-10-12'); // −67,10 €
  assert.strictEqual(C.outstandingCents(s, inv), 0);
  assert.strictEqual(C.refundDueCents(s, inv), 6710);
  assert.strictEqual(C.balanceCents(s, inv), -6710);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-13'), 'refund_due');
  inv.refunds = [{ id: 'r1', date: '2026-10-14', amount: 2000 }];
  assert.strictEqual(C.refundDueCents(s, inv), 4710);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-14'), 'refund_due');
  inv.refunds.push({ id: 'r2', date: '2026-10-15', amount: 4710 });
  assert.strictEqual(C.refundedCents(inv), 6710);
  assert.strictEqual(C.refundDueCents(s, inv), 0);
  assert.strictEqual(C.outstandingCents(s, inv), 0);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-15'), 'paid');
});

t('credit note bigger than the open part of a partly paid invoice: refund only the difference', () => {
  const s = newState();
  const inv = draft(s, 'nimbus', [line('Audit', 1, 3200)]); // export: no VAT, 3.200,00 €
  issue(s, inv, '2026-10-01');
  pay(inv, 300000, '2026-10-05');
  creditNote(s, inv, [line('Audit', -1, 500)], '2026-10-06'); // now worth 2.700,00 €, paid 3.000,00 €
  assert.strictEqual(C.refundDueCents(s, inv), 30000);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-06'), 'refund_due');
  creditNote(s, inv, [line('Audit', -1, 2700)], '2026-10-07'); // fully credited after payment: everything back
  assert.strictEqual(C.refundDueCents(s, inv), 300000);
  assert.strictEqual(C.statusOf(s, inv, '2026-10-07'), 'refund_due');
  inv.refunds = [{ id: 'r', date: '2026-10-08', amount: 300000 }];
  assert.strictEqual(C.statusOf(s, inv, '2026-10-08'), 'credited');
});

t('old saved invoices without refunds behave exactly as before', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 1, 100)]);
  issue(s, inv, '2026-10-01');
  delete inv.refunds;
  pay(inv, 5000, '2026-10-02');
  assert.strictEqual(C.outstandingCents(s, inv), 12200 - 5000);
  assert.strictEqual(C.refundDueCents(s, inv), 0);
  const cn = s.invoices.find((i) => i.kind === 'credit_note');
  assert.strictEqual(cn, undefined);
});

// ---------- PDF payment box ----------
t('PDF: unpaid invoice shows the full amount with a UPN QR', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 1, 100)]);
  issue(s, inv, '2026-10-01');
  const opts = C.pdfPayment(s, inv);
  assert.deepStrictEqual(opts, { amountDue: 12200 });
  assert.deepStrictEqual(C.paymentBlock(inv.snapshot, opts), { kind: 'due', amount: 12200, remaining: false, qr: true });
  assert.strictEqual(C.qrKind(inv.snapshot), 'upn');
  assert.ok(C.upnQrText(inv.snapshot, opts.amountDue).includes('\n00000012200\n'));
});

t('PDF: partly paid invoice shows only the remaining amount, in the text and the QR', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 1, 100)]);
  issue(s, inv, '2026-10-01');
  pay(inv, 2200, '2026-10-02');
  const opts = C.pdfPayment(s, inv);
  assert.deepStrictEqual(opts, { amountDue: 10000 });
  assert.deepStrictEqual(C.paymentBlock(inv.snapshot, opts), { kind: 'due', amount: 10000, remaining: true, qr: true });
  assert.ok(C.upnQrText(inv.snapshot, opts.amountDue).includes('\n00000010000\n'));
});

t('PDF: fully paid invoice shows "paid on" the last payment date and no QR', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 1, 100)]);
  issue(s, inv, '2026-10-01');
  pay(inv, 2200, '2026-10-02');
  pay(inv, 10000, '2026-10-09');
  const opts = C.pdfPayment(s, inv);
  assert.deepStrictEqual(opts, { amountDue: 0, paidOn: '2026-10-09' });
  assert.deepStrictEqual(C.paymentBlock(inv.snapshot, opts), { kind: 'paid', paidOn: '2026-10-09' });
});

t('PDF: paid then credited (refund due) still prints as paid; fully credited unpaid has no payment box', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 1, 100)]);
  issue(s, inv, '2026-10-01');
  pay(inv, 12200, '2026-10-03');
  creditNote(s, inv, [line('A', -1, 100)], '2026-10-04');
  assert.deepStrictEqual(C.paymentBlock(inv.snapshot, C.pdfPayment(s, inv)), { kind: 'paid', paidOn: '2026-10-03' });
  const inv2 = draft(s, 'lipa', [line('B', 1, 100)]);
  issue(s, inv2, '2026-10-05');
  creditNote(s, inv2, [line('B', -1, 100)], '2026-10-05');
  const o2 = C.pdfPayment(s, inv2);
  assert.deepStrictEqual(o2, { amountDue: 0 });
  assert.deepStrictEqual(C.paymentBlock(inv2.snapshot, o2), { kind: 'none' });
});

t('PDF: drafts, credit notes, the archive copy and non-EU customers', () => {
  const s = newState();
  const d = draft(s, 'lipa', [line('A', 1, 100)]);
  assert.deepStrictEqual(C.pdfPayment(s, d), {});
  const fakeSnap = C.buildSnapshot(s, { ...d, dueDate: '2026-10-16' }, { issueDate: '2026-10-01', seq: 1 });
  assert.deepStrictEqual(C.paymentBlock(fakeSnap, { draft: true }), { kind: 'due', amount: 12200, remaining: false, qr: false });
  issue(s, d, '2026-10-01');
  pay(d, 12200, '2026-10-02');
  // the yearly archive prints the document as issued (full amount), whatever was paid later
  assert.deepStrictEqual(C.paymentBlock(d.snapshot, { amountDue: d.snapshot.totals.total }), { kind: 'due', amount: 12200, remaining: false, qr: true });
  const cn = creditNote(s, d, [line('A', -1, 100)], '2026-10-03');
  assert.deepStrictEqual(C.pdfPayment(s, cn), {});
  assert.deepStrictEqual(C.paymentBlock(cn.snapshot, {}), { kind: 'none' });
  const us = draft(s, 'nimbus', [line('Audit', 1, 3200)]);
  issue(s, us, '2026-10-04');
  assert.deepStrictEqual(C.paymentBlock(us.snapshot, C.pdfPayment(s, us)), { kind: 'due', amount: 320000, remaining: false, qr: false });
  const at = draft(s, 'bright', [line('Retainer', 1, 2500)]);
  issue(s, at, '2026-10-05');
  assert.strictEqual(C.paymentBlock(at.snapshot, C.pdfPayment(s, at)).qr, true); // SEPA (EPC) QR
});

// ---------- copies: sync conflicts and restore ----------
const copy = (s) => JSON.parse(JSON.stringify(s));
function twoDevices() {
  const base = newState();
  issue(base, draft(base, 'lipa', [line('A', 1, 1000)]), '2026-10-01');                // VZ-2026-0001 1.220,00 €
  issue(base, draft(base, 'bright', [line('Retainer', 1, 2500)]), '2026-10-02');       // VZ-2026-0002 2.500,00 €
  return base;
}

t('compareCopies: nothing lost between identical copies or when the target has more', () => {
  const a = twoDevices();
  const b = copy(a);
  issue(b, draft(b, 'lipa', [line('C', 1, 10)]), '2026-10-03');
  assert.deepStrictEqual(C.compareCopies(a, copy(a)), { lost: [], reused: [] });
  assert.deepStrictEqual(C.compareCopies(a, b).lost, []);
  assert.deepStrictEqual(C.describeLoss(a, b), []);
});

t('describeLoss: issued documents missing from the other copy, as "number · client · amount"', () => {
  const cloud = twoDevices();
  const here = copy(cloud);
  const inv = draft(here, 'nimbus', [line('Nov', 1, 1234)]);                            // export, no VAT: 1.234,00 €
  issue(here, inv, '2026-10-05');
  creditNote(here, here.invoices[0], [line('A', -1, 100)], '2026-10-06');
  const lines = C.describeLoss(here, cloud);
  assert.deepStrictEqual(lines, [
    `VZ-2026-0003 · Nimbus Cloud, Inc. · ${C.eur(inv.snapshot.totals.total)}`,
    `VZ-2026-0004 · Studio Lipa d.o.o. · ${C.eur(-12200)}`,
  ]);
  assert.strictEqual(C.eur(123400), '1.234,00 €');
  assert.strictEqual(lines[0], 'VZ-2026-0003 · Nimbus Cloud, Inc. · 1.234,00 €');
  assert.deepStrictEqual(C.describeLoss(cloud, here), []); // taking this browser's copy loses nothing
});

t('describeLoss: the same number issued on two devices for different documents is flagged both ways', () => {
  const base = twoDevices();
  const phone = copy(base), laptop = copy(base);
  issue(phone, draft(phone, 'lipa', [line('Phone', 1, 100)]), '2026-10-05');
  issue(laptop, draft(laptop, 'nimbus', [line('Laptop', 1, 300)]), '2026-10-05');
  const p2l = C.compareCopies(phone, laptop);
  assert.strictEqual(p2l.lost.length, 1);
  assert.deepStrictEqual([p2l.lost[0].number, p2l.lost[0].clash, p2l.lost[0].reused], ['VZ-2026-0003', true, true]);
  assert.deepStrictEqual(C.describeLoss(phone, laptop), ['VZ-2026-0003 · Studio Lipa d.o.o. · 122,00 € · the other copy has a different document with this number']);
  assert.deepStrictEqual(C.describeLoss(laptop, phone), ['VZ-2026-0003 · Nimbus Cloud, Inc. · 300,00 € · the other copy has a different document with this number']);
});

t('describeLoss: drafts are not counted, and odd or empty data never throws', () => {
  const a = twoDevices();
  const b = copy(a);
  draft(a, 'lipa', [line('Draft only here', 1, 10)]);
  assert.deepStrictEqual(C.describeLoss(a, b), []);
  assert.deepStrictEqual(C.describeLoss(a, null).length, 2);
  assert.deepStrictEqual(C.describeLoss(null, a), []);
  assert.deepStrictEqual(C.describeLoss({}, {}), []);
  assert.deepStrictEqual(C.describeLoss({ invoices: [{ number: 'X-1' }] }, { invoices: [] }), ['X-1 · ? · 0,00 €']);
});

t('restore comparison: an older backup loses the newer documents and would give their numbers again', () => {
  const backup = twoDevices();
  const now = copy(backup);
  const later = draft(now, 'lipa', [line('Later', 2, 50)]);
  issue(now, later, '2026-10-07');
  pay(now.invoices[0], 122000, '2026-10-08');
  const r = C.compareCopies(now, backup);
  assert.deepStrictEqual(r.lost.map((l) => [l.number, l.customer, l.total, l.clash, l.reused]), [['VZ-2026-0003', 'Studio Lipa d.o.o.', 12200, false, true]]);
  assert.deepStrictEqual(r.reused.map((l) => l.number), ['VZ-2026-0003']);
  // after restoring, the next document would indeed get the lost number
  assert.strictEqual(C.formatNumber(backup.settings.numberPrefix, 2026, C.nextSeq(backup, 2026)), 'VZ-2026-0003');
  // restoring a backup that is newer loses nothing
  assert.deepStrictEqual(C.compareCopies(backup, now), { lost: [], reused: [] });
});

t('restore comparison: a backup from another series lists every issued document here', () => {
  const now = twoDevices();
  const other = newState();
  issue(other, draft(other, 'nimbus', [line('Other', 1, 1)]), '2026-09-01');
  const r = C.compareCopies(now, other);
  assert.deepStrictEqual(r.lost.map((l) => [l.number, l.clash]), [['VZ-2026-0001', true], ['VZ-2026-0002', false]]);
  assert.strictEqual(r.reused.length, 2);
});

// ======================================================================================================
// Quotes / proforma invoices: their own number series, never mixed with invoice numbers
// ======================================================================================================
function quote(state, clientId, lines, extra = {}) {
  const c = state.clients.find((x) => x.id === clientId);
  state.quotes = state.quotes || [];
  const q = { id: id('q'), kind: 'quote', clientId, treatment: c.treatment, lang: c.lang, supplyFrom: '', supplyTo: '', validDays: 30, paymentDays: 8, note: '', lines, ...extra };
  state.quotes.push(q);
  return q;
}
function finalise(state, q, date) {
  const probs = C.quoteProblems(state, q, date);
  if (probs.length) throw new Error(probs.join('; '));
  return C.issueQuote(state, q, date, `${date}T09:00:00.000Z`);
}

t('quotes are numbered in their own series and never move the invoice counter', () => {
  const s = newState();
  issue(s, draft(s, 'lipa', [line('A', 1, 100)]), '2026-10-01');
  const q1 = quote(s, 'lipa', [line('Q', 2, 50)]);
  const q2 = quote(s, 'bright', [line('Q2', 1, 900)], { kind: 'proforma' });
  finalise(s, q1, '2026-10-02');
  finalise(s, q2, '2026-10-03');
  assert.deepStrictEqual([q1.number, q2.number], ['PR-2026-0001', 'PR-2026-0002']);
  assert.deepStrictEqual(s.quoteCounters, { 2026: 2 });
  assert.deepStrictEqual(s.counters, { 2026: 1 }, 'invoice counter untouched');
  const b = draft(s, 'lipa', [line('B', 1, 100)]);
  issue(s, b, '2026-10-04');
  assert.strictEqual(b.number, 'VZ-2026-0002', 'next invoice follows the invoice series');
  assert.deepStrictEqual(C.numberingProblems(s), []);
  assert.deepStrictEqual(C.quoteNumberingProblems(s), []);
  // quotes are not issued documents: no VAT ledger rows, no RP-O rows
  assert.strictEqual(C.kirRows(s, '2026-01-01', '2026-12-31').length, 2);
  // a new year restarts the quote series
  const q3 = quote(s, 'lipa', [line('Q3', 1, 10)]);
  s.quoteCounters['2027'] = 0;
  const snap = C.buildQuoteSnapshot(s, q3, { issueDate: '2027-01-02', seq: C.quoteNextSeq(s, 2027) });
  assert.strictEqual(snap.number, 'PR-2027-0001');
});

t('quote snapshot: validity, proforma payment reference and QR, plain quote has none', () => {
  const s = newState();
  const q = quote(s, 'lipa', [line('Spletna stran', 1, 1000)]);
  const p = quote(s, 'lipa', [line('Predplačilo', 1, 500)], { kind: 'proforma', paymentDays: 8 });
  const sq = finalise(s, q, '2026-10-01');
  const sp = finalise(s, p, '2026-10-01');
  assert.strictEqual(sq.kind, 'quote');
  assert.strictEqual(sq.validUntil, '2026-10-31');
  assert.strictEqual(sq.reference, null);
  assert.strictEqual(sq.dueDate, null);
  assert.strictEqual(C.qrKind(sq), null);
  assert.deepStrictEqual(C.paymentBlock(sq, {}), { kind: 'none' });
  assert.strictEqual(sp.reference, 'SI00 99-2026-0002');
  assert.strictEqual(sp.dueDate, '2026-10-09');
  assert.strictEqual(C.qrKind(sp), 'upn');
  assert.strictEqual(C.paymentBlock(sp, {}).kind, 'due');
  assert.strictEqual(sp.totals.total, 61000);
  assert.ok(C.upnQrText(sp, 61000).includes('Predračun PR-2026-0002\n'));
  // the invoice QR text is unchanged
  const inv = draft(s, 'lipa', [line('A', 1, 100)]);
  issue(s, inv, '2026-10-02');
  assert.ok(C.upnQrText(inv.snapshot, 12200).includes(`Račun ${inv.number}\n`));
});

t('quote checks: prefix must differ from the invoice prefix; quantity, client and lines needed', () => {
  const s = newState();
  s.settings.quotePrefix = 'VZ-';
  const q = quote(s, 'lipa', [line('', 0, 10)]);
  const probs = C.quoteProblems(s, q, '2026-10-01');
  assert.ok(probs.some((p) => /prefix that differs/.test(p)));
  assert.ok(probs.some((p) => /description/.test(p)));
  assert.ok(probs.some((p) => /quantity above zero/.test(p)));
  assert.ok(C.quoteProblems(s, q, '2999-01-01').some((p) => /not in the future/.test(p)));
  delete s.settings.quotePrefix;
  assert.strictEqual(C.quotePrefix(s.settings), 'PR-');
});

t('quote status and "convert to invoice" makes an invoice draft (no number) with the same lines', () => {
  const s = newState();
  const q = quote(s, 'bright', [{ description: 'Workshop', qty: 2, unit: 'day', unitPrice: 800, discountPct: 5, vatRate: 22 }], { kind: 'proforma' });
  assert.strictEqual(C.quoteStatus(s, q, '2026-10-05'), 'draft');
  finalise(s, q, '2026-10-01');
  assert.strictEqual(C.quoteStatus(s, q, '2026-10-05'), 'open');
  assert.strictEqual(C.quoteStatus(s, q, '2026-11-05'), 'expired');
  q.decision = 'accepted';
  assert.strictEqual(C.quoteStatus(s, q, '2026-11-05'), 'accepted');
  const inv = { id: 'inv-from-q', ...C.invoiceFromQuote(q, { today: '2026-10-06' }), payments: [] };
  assert.strictEqual(inv.kind, 'invoice');
  assert.strictEqual(inv.number, undefined);
  assert.strictEqual(inv.lang, 'en');
  assert.strictEqual(inv.note, `As per proforma invoice ${q.number}`);
  assert.strictEqual(inv.fromQuote, q.id);
  assert.deepStrictEqual(inv.lines, [{ description: 'Workshop', qty: 2, unit: 'day', unitPrice: 800, discountPct: 5, vatRate: 22 }]);
  s.invoices.push(inv);
  q.invoiceId = inv.id;
  assert.strictEqual(C.quoteStatus(s, q), 'invoiced');
  s.invoices = s.invoices.filter((i) => i.id !== inv.id); // draft deleted: the quote can be converted again
  assert.strictEqual(C.quoteStatus(s, q, '2026-10-05'), 'accepted');
  const sl = C.invoiceFromQuote({ ...q, kind: 'quote', lang: 'sl', snapshot: { ...q.snapshot, lang: 'sl' } });
  assert.strictEqual(sl.note, `Po ponudbi ${q.number}`);
});

// ======================================================================================================
// English invoices read English
// ======================================================================================================
t('country names and units follow the invoice language', () => {
  assert.strictEqual(C.countryName('AT', 'en'), 'Austria');
  assert.strictEqual(C.countryName('AT', 'sl'), 'Avstrija');
  assert.strictEqual(C.countryName('US', 'en'), 'United States');
  assert.strictEqual(C.countryName('XX', 'en'), 'XX');
  assert.strictEqual(C.unitLabel('mes.', 'en'), 'month');
  assert.strictEqual(C.unitLabel('kos', 'en'), 'pc');
  assert.strictEqual(C.unitLabel('ur', 'en'), 'h');
  assert.strictEqual(C.unitLabel('mes.', 'sl'), 'mes.');
  assert.strictEqual(C.unitLabel('license', 'en'), 'license');
  assert.strictEqual(C.translateUnit('mes.', 'en'), 'month');
  assert.strictEqual(C.translateUnit('month', 'sl'), 'mes.');
  assert.strictEqual(C.translateUnit('h', 'sl'), 'ur');
  assert.strictEqual(C.translateUnit('kg', 'en'), 'kg');
  // every country the client form offers has a name in both languages
  for (const k of ['SI', 'HR', 'AT', 'IT', 'DE', 'HU', 'CZ', 'SK', 'PL', 'FR', 'NL', 'BE', 'IE', 'ES', 'PT', 'SE', 'DK', 'FI', 'LU', 'RO', 'BG', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT', 'GB', 'CH', 'NO', 'RS', 'BA', 'ME', 'MK', 'AL', 'US', 'CA', 'AU']) {
    assert.ok(C.COUNTRY_NAMES.en[k] && C.COUNTRY_NAMES.sl[k], k);
  }
});

t('billing run: English clients get English units and the English contract title', () => {
  const s = newState();
  s.contracts.push({ id: 'k1', clientId: 'bright', title: 'Mesečni pavšal', titleEn: 'Monthly retainer', monthlyFee: 2500, timing: 'advance', start: '2026-01-01' });
  s.contracts.push({ id: 'k2', clientId: 'lipa', title: '', monthlyFee: 1200, timing: 'advance', start: '2026-01-01' });
  s.work.push({ id: 'w1', clientId: 'bright', date: '2026-09-10', description: 'Analysis', mode: 'hours', hours: 2, rate: 85, billable: true, invoiceId: null });
  s.work.push({ id: 'w2', clientId: 'lipa', date: '2026-09-10', description: 'Nalepke', mode: 'fixed', amount: 180, billable: true, invoiceId: null });
  const plans = C.planRun(s, '2026-10');
  const en = plans.find((p) => p.client.id === 'bright');
  const sl = plans.find((p) => p.client.id === 'lipa');
  assert.deepStrictEqual(en.lines.map((l) => [l.description, l.unit]), [['Monthly retainer – 2026-10', 'month'], ['Analysis (10. 09. 2026)', 'h']]);
  assert.deepStrictEqual(sl.lines.map((l) => [l.description, l.unit]), [['Mesečni pavšal – 2026-10', 'mes.'], ['Nalepke (10. 09. 2026)', 'kos']]);
});

// ======================================================================================================
// Payment reminders and the .eml file
// ======================================================================================================
t('reminder letter: open amount after a part payment, days late, SL and EN wording', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 1, 1000)]);
  issue(s, inv, '2026-09-01'); // due 16. 9.
  pay(inv, 22000, '2026-09-20');
  const L = C.reminderLetter(s, inv, { lang: 'sl', stage: 0, today: '2026-10-15', deadline: '2026-10-23' });
  assert.strictEqual(L.open, 100000);
  assert.strictEqual(L.rows[0].daysLate, 29);
  assert.strictEqual(L.rows[0].paid, 22000);
  assert.strictEqual(L.title, 'Obvestilo o zapadlem računu');
  assert.ok(L.paragraphs[1].includes('najpozneje do 23. 10. 2026'));
  assert.ok(L.paragraphs.some((p) => p.includes('1.000,00 €') && p.includes('SI00 2026-0001')));
  assert.ok(!L.paragraphs.some((p) => /zamudnih obresti/.test(p)), 'friendly reminder: no interest sentence');
  assert.strictEqual(L.subject, 'Obvestilo o zapadlem računu – račun VZ-2026-0001');
  inv.reminders = [{ date: '2026-10-15', stage: 0 }];
  const L2 = C.reminderLetter(s, inv, { lang: 'en', stage: 1, today: '2026-10-30', deadline: '2026-11-07' });
  assert.strictEqual(L2.title, 'Reminder');
  assert.ok(L2.paragraphs[1].startsWith('Despite our reminder of 15. 10. 2026'));
  assert.ok(L2.paragraphs.some((p) => /statutory default interest/.test(p)));
  assert.ok(L2.mailText.includes('Please pay it by 07. 11. 2026'));
  assert.strictEqual(L2.placeDate, 'Ljubljana, 30. 10. 2026');
});

t('base64 matches Node, and the .eml is a multipart message with the PDF attached', () => {
  const bytes = new Uint8Array(1000).map((_, k) => (k * 37 + 11) % 256);
  for (const len of [0, 1, 2, 3, 4, 5, 999, 1000]) assert.strictEqual(C.base64(bytes.slice(0, len)), Buffer.from(bytes.slice(0, len)).toString('base64'), `len ${len}`);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const eml = C.buildEml({ from: { name: 'Vzorec d.o.o.', email: 'racuni@vzorec.example' }, to: { name: 'Studio Lipa d.o.o.', email: 'racuni@studio-lipa.example' },
    subject: 'Opomin – račun VZ-2026-0001', text: 'Spoštovani,\nprosimo za plačilo.', attachments: [{ name: 'opomin-VZ-2026-0001.pdf', type: 'application/pdf', bytes: pdf }],
    date: new Date('2026-10-15T08:00:00Z'), boundary: 'BOUND' });
  assert.ok(eml.includes('MIME-Version: 1.0\r\n'));
  assert.ok(eml.includes('X-Unsent: 1\r\n'));
  assert.ok(eml.includes('To: "Studio Lipa d.o.o." <racuni@studio-lipa.example>\r\n'));
  assert.ok(eml.includes(`Subject: =?UTF-8?B?${Buffer.from('Opomin – račun VZ-2026-0001').toString('base64')}?=\r\n`));
  assert.ok(eml.includes('Content-Type: multipart/mixed; boundary="BOUND"'));
  assert.ok(eml.includes('Content-Disposition: attachment; filename="opomin-VZ-2026-0001.pdf"'));
  assert.ok(eml.includes(Buffer.from(pdf).toString('base64')));
  assert.ok(eml.trimEnd().endsWith('--BOUND--'));
  const textPart = eml.split('--BOUND')[1].split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.strictEqual(Buffer.from(textPart, 'base64').toString('utf8'), 'Spoštovani,\r\nprosimo za plačilo.');
  assert.ok(eml.split('\r\n').every((l) => l.length <= 998), 'no line longer than RFC 5322 allows');
});

// ======================================================================================================
// Bank statement import (camt.053 and CSV)
// ======================================================================================================
const B = require(path.join(__dirname, '../../site/billing/bank.js'));
const camt = (entries, { ns = 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.02', iban = 'SI56191000000123438' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${ns}"><BkToCstmrStmt><GrpHdr><MsgId>M1</MsgId><CreDtTm>2026-10-15T07:00:00</CreDtTm></GrpHdr>
<Stmt><Id>2026/41</Id><ElctrncSeqNb>41</ElctrncSeqNb><Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy></Acct>${entries}</Stmt></BkToCstmrStmt></Document>`;
const ntry = ({ amt, dir = 'CRDT', sts = 'BOOK', date = '2026-10-10', ref = '', ustrd = '', name = 'Studio Lipa d.o.o.', acctRef = '', v8 = false, tx = null, rvsl = false }) => `
<Ntry><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>${dir}</CdtDbtInd>${rvsl ? '<RvslInd>true</RvslInd>' : ''}${v8 ? `<Sts><Cd>${sts}</Cd></Sts>` : `<Sts>${sts}</Sts>`}<BookgDt><Dt>${date}</Dt></BookgDt><ValDt><Dt>${date}</Dt></ValDt>
${acctRef ? `<AcctSvcrRef>${acctRef}</AcctSvcrRef>` : ''}<NtryDtls>${tx || `<TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
<RltdPties>${v8 ? `<Dbtr><Pty><Nm>${name}</Nm></Pty></Dbtr>` : `<Dbtr><Nm>${name}</Nm></Dbtr>`}<DbtrAcct><Id><IBAN>SI56020100000000000</IBAN></Id></DbtrAcct></RltdPties>
<RmtInf>${ustrd ? `<Ustrd>${ustrd}</Ustrd>` : ''}${ref ? `<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${ref}</Ref></CdtrRefInf></Strd>` : ''}</RmtInf></TxDtls>`}</NtryDtls></Ntry>`;

t('XML reader: entities, CDATA, comments, namespace prefixes', () => {
  const d = B.parseXml('<?xml version="1.0"?><!-- c --><a:Doc xmlns:a="x"><a:B k="1 &amp; 2">x &lt; y &#x10D; &#269;</a:B><C><![CDATA[<raw>]]></C><D/></a:Doc>');
  const doc = d.children[0];
  assert.strictEqual(doc.name, 'Doc');
  assert.strictEqual(doc.children[0].attrs.k, '1 & 2');
  assert.strictEqual(doc.children[0].text, 'x < y č č');
  assert.strictEqual(doc.children[1].text, '<raw>');
  assert.strictEqual(doc.children[2].name, 'D');
  assert.throws(() => B.parseXml('<a><b></a>'));
});

t('camt.053: incoming booked payments only, v02 and v08 names, batch entries split by transaction', () => {
  const batch = `<TxDtls><Refs><EndToEndId>E1</EndToEndId><AcctSvcrRef>T1</AcctSvcrRef></Refs><AmtDtls><TxAmt><Amt Ccy="EUR">100.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>A d.o.o.</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>SI00 2026-0002</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>
    <TxDtls><Refs><AcctSvcrRef>T2</AcctSvcrRef></Refs><AmtDtls><TxAmt><Amt Ccy="EUR">50.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>B s.p.</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Racun 2026-0003</Ustrd></RmtInf></TxDtls>`;
  const xml = camt([
    ntry({ amt: '1220.00', ref: 'SI002026-0001', acctRef: 'R1' }),
    ntry({ amt: '80.00', dir: 'DBIT' }),
    ntry({ amt: '10.00', sts: 'PDNG' }),
    ntry({ amt: '33.00', rvsl: true }),
    ntry({ amt: '500.00', v8: true, name: 'Brightline Analytics GmbH', ustrd: 'Invoice VZ-2026-0004' }),
    ntry({ amt: '150.00', acctRef: 'R5', tx: batch }),
  ].join(''), { ns: 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08' });
  const r = B.parseStatement(xml, { name: 'izpisek.xml' });
  assert.strictEqual(r.format, 'camt.053');
  assert.deepStrictEqual(r.skipped, { debit: 1, pending: 1, reversal: 1 });
  assert.strictEqual(r.statements[0].iban, 'SI56191000000123438');
  assert.deepStrictEqual(r.txs.map((x) => [x.amount, x.name, x.reference]), [
    [122000, 'Studio Lipa d.o.o.', 'SI002026-0001'], [50000, 'Brightline Analytics GmbH', ''], [10000, 'A d.o.o.', 'SI00 2026-0002'], [5000, 'B s.p.', ''],
  ]);
  assert.strictEqual(r.txs[0].date, '2026-10-10');
  assert.strictEqual(r.txs[3].purpose, 'Racun 2026-0003');
  assert.strictEqual(new Set(r.txs.map((x) => x.key)).size, 4, 'every transaction has its own key');
  assert.strictEqual(B.parseStatement(xml).txs[0].key, r.txs[0].key, 'the same file gives the same keys');
  assert.throws(() => B.parseStatement('<x/>', { name: 'a.xml' }), /not a camt\.053/);
});

function bankFixture() {
  const s = newState();
  const a = draft(s, 'lipa', [line('A', 1, 1000)]); issue(s, a, '2026-10-01'); // 1220,00, SI00 2026-0001
  const b = draft(s, 'bright', [line('B', 1, 500)]); issue(s, b, '2026-10-02'); // 500,00 (reverse charge), 2026-0002
  const c = draft(s, 'lipa', [line('C', 1, 250)]); issue(s, c, '2026-10-03'); // 305,00, 2026-0003
  const d = draft(s, 'nimbus', [line('D', 1, 305)]); issue(s, d, '2026-10-03'); // 305,00 too, 2026-0004
  return { s, a, b, c, d };
}
const tx = (o) => ({ key: `k-${o.amount}-${o.reference || ''}-${o.name || ''}-${o.date || ''}`, date: '2026-10-10', currency: 'EUR', references: o.reference ? [o.reference] : [], name: '', purpose: '', reference: '', ...o });

t('matching: reference first, then invoice number in the purpose, then amount + payer, amount alone is only a suggestion', () => {
  const { s, a, b, c } = bankFixture();
  const rows = B.evaluate(s, B.suggest(s, [
    tx({ amount: 122000, reference: 'SI00 2026-0001' }),
    tx({ amount: 50000, purpose: 'Placilo racuna VZ-2026-0002' }),
    tx({ amount: 30500, name: 'STUDIO LIPA DOO' }),
    tx({ amount: 30500, name: 'Someone Else' }),
    tx({ amount: 999, name: 'Nobody' }),
    tx({ amount: 10000, reference: 'SI00 99-2026-0004' }),
  ]), '2026-10-15');
  assert.deepStrictEqual(rows.map((r) => [r.invoiceId, r.how, r.selected]), [
    [a.id, 'reference', true], [b.id, 'number', true], [c.id, 'amount_name', true], ['', 'none', false], ['', 'none', false], ['', 'none', false],
  ]);
  assert.match(rows[5].problem, /proforma SI00 99-2026-0004/);
  // a single open invoice with that amount: suggested, not ticked
  const { s: s2, d } = bankFixture();
  s2.invoices = s2.invoices.filter((i) => i.number !== 'VZ-2026-0003');
  const [only] = B.evaluate(s2, B.suggest(s2, [tx({ amount: 30500, name: 'Unknown' })]), '2026-10-15');
  assert.deepStrictEqual([only.invoiceId, only.how, only.selected, only.recordable], [d.id, 'amount', false, true]);
});

t('evaluation: already imported, part payments share the open amount, overpaid, before the invoice date', () => {
  const { s, a } = bankFixture();
  a.payments.push({ id: 'p0', date: '2026-10-05', amount: 1000, bankKey: 'k-old' });
  const rows = B.evaluate(s, B.suggest(s, [
    tx({ key: 'k-old', amount: 1000, reference: 'SI002026-0001' }),
    tx({ amount: 100000, reference: 'SI002026-0001', date: '2026-10-11' }),
    tx({ amount: 30000, reference: 'SI002026-0001', date: '2026-10-12' }),
    tx({ amount: 5000, reference: 'SI002026-0001', date: '2026-10-13' }),
    tx({ amount: 30500, reference: 'SI002026-0003', date: '2026-09-30' }),
  ]), '2026-10-15');
  assert.match(rows[0].problem, /Already recorded on VZ-2026-0001/);
  assert.deepStrictEqual([rows[1].recordable, rows[1].amount], [true, 100000]);
  assert.deepStrictEqual([rows[2].recordable, rows[2].amount], [true, 21000], 'only what is still open after the row before');
  assert.match(rows[2].note, /more than still due/);
  assert.match(rows[3].problem, /already paid/);
  assert.match(rows[4].problem, /before the invoice date/);
});

t('CSV statements: Slovenian headers, decimal commas, credit/debit columns, quoted fields', () => {
  const csv = '﻿Izpisek;;;\r\nDatum valute;Naziv plačnika;Sklic prejemnika;Namen plačila;V breme;V dobro\r\n'
    + '10.10.2026;Studio Lipa d.o.o.;SI00 2026-0001;"Račun 2026-0001; hvala";;1.220,00\r\n'
    + '11. 10. 2026;Elektro d.d.;;Elektrika;45,10;\r\n'
    + '12.10.2026;"Brightline ""BA"" GmbH";;Invoice 2026-0002;;500,00\r\n';
  const r = B.parseStatement(csv, { name: 'izpisek.csv' });
  assert.strictEqual(r.format, 'csv');
  assert.strictEqual(r.delim, ';');
  assert.deepStrictEqual(r.skipped, { debit: 1, unreadable: 0 });
  assert.deepStrictEqual(r.txs.map((x) => [x.date, x.amount, x.name, x.reference]), [
    ['2026-10-10', 122000, 'Studio Lipa d.o.o.', 'SI00 2026-0001'], ['2026-10-12', 50000, 'Brightline "BA" GmbH', ''],
  ]);
  assert.strictEqual(r.txs[0].purpose, 'Račun 2026-0001; hvala');
  // one signed amount column, English headers, comma separated
  const en = 'Booking date,Counterparty,Reference,Description,Amount\n2026-10-10,Studio Lipa,SI002026-0001,Invoice,1220.00\n2026-10-11,Shop,,Card,-12.50\n';
  const e = B.parseStatement(en, { name: 'statement.csv' });
  assert.deepStrictEqual(e.txs.map((x) => [x.amount, x.reference]), [[122000, 'SI002026-0001']]);
  // choosing the columns by hand
  const odd = 'Kdaj;Kdo;Koliko\n10.10.2026;Studio Lipa;1.220,00\n';
  assert.strictEqual(B.parseStatement(odd).txs.length, 0);
  assert.deepStrictEqual(B.parseStatement(odd, { map: { date: 0, name: 1, amount: 2 } }).txs.map((x) => [x.date, x.amount]), [['2026-10-10', 122000]]);
});

t('amounts and dates as banks write them', () => {
  const cases = [['1.234,56', true, 123456], ['-1.234,56', true, -123456], ['−1.234,56', true, -123456], ['1234,56', true, 123456], ['1,234.56', false, 123456],
    ['1234.56', false, 123456], ['1 234,56 €', true, 123456], ['12,5', true, 1250], ['1.234', true, 123400], ['(45,00)', true, -4500], ['45,00-', true, -4500], ['', true, null], ['abc', true, null]];
  for (const [v, dc, want] of cases) assert.strictEqual(B.parseAmount(v, dc), want, v);
  assert.strictEqual(B.parseDate('5.1.2026'), '2026-01-05');
  assert.strictEqual(B.parseDate('15. 10. 2026'), '2026-10-15');
  assert.strictEqual(B.parseDate('2026-10-15T10:00:00'), '2026-10-15');
  assert.strictEqual(B.parseDate('15/10/26'), '2026-10-15');
  assert.strictEqual(B.parseDate('Oct 15'), '');
});

// ======================================================================================================
// e-SLOG 2.0
// ======================================================================================================
const E = require(path.join(__dirname, '../../site/billing/eslog.js'));
const node = (root, pathStr) => pathStr.split('/').reduce((n, p) => n && n.children.find((c) => c.name === p), root);
const all = (n, name) => n.children.filter((c) => c.name === name);
const moaOf = (group, code) => { const g = group.find((x) => node(x, 'S_MOA/C_C516/D_5025').text === code); return g ? node(g, 'S_MOA/C_C516/D_5004').text : null; };

t('e-SLOG 2.0: a domestic invoice carries the business terms in the GZS segments', () => {
  const s = newState();
  s.clients[0].email = 'racuni@studio-lipa.example';
  const inv = draft(s, 'lipa', [line('Mesečni pavšal', 1, 1200), { description: 'Dodatna dela', qty: 3.5, unit: 'ur', unitPrice: 60, discountPct: 10, vatRate: 9.5 }], { supplyFrom: '2026-09-01', supplyTo: '2026-09-30' });
  issue(s, inv, '2026-10-01');
  const xml = E.xml(inv.snapshot);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:eslog:2.00"'));
  const doc = B.parseXml(xml).children[0];
  const m = node(doc, 'M_INVOIC');
  assert.strictEqual(m.attrs.Id, 'data');
  assert.strictEqual(node(m, 'S_BGM/C_C002/D_1001').text, '380');
  assert.strictEqual(node(m, 'S_BGM/C_C106/D_1004').text, 'VZ-2026-0001');
  const dtm = all(m, 'S_DTM').map((d) => [node(d, 'C_C507/D_2005').text, node(d, 'C_C507/D_2380').text]);
  assert.deepStrictEqual(dtm, [['137', '2026-10-01'], ['167', '2026-09-01'], ['168', '2026-09-30']]);
  const ftx = Object.fromEntries(all(m, 'S_FTX').map((f) => [node(f, 'D_4451').text, f]));
  assert.strictEqual(node(ftx.DOC, 'C_C108/D_4440').text, 'urn:cen.eu:en16931:2017');
  assert.strictEqual(node(ftx.PAI, 'C_C108/D_4440').text, '0');
  assert.ok(!ftx.AGM, 'standard rate: no exemption text');
  const pq = all(m, 'G_SG1').find((g) => node(g, 'S_RFF/C_C506/D_1153').text === 'PQ');
  assert.strictEqual(node(pq, 'S_RFF/C_C506/D_1154').text, 'SI002026-0001');
  const [buyer, seller] = all(m, 'G_SG2');
  assert.strictEqual(node(buyer, 'S_NAD/D_3035').text, 'BY');
  assert.strictEqual(node(buyer, 'S_NAD/D_3251').text, '1000');
  assert.strictEqual(node(buyer, 'S_NAD/D_3164').text, 'Ljubljana');
  const ref = (p, q) => node(all(p, 'G_SG3').find((g) => node(g, 'S_RFF/C_C506/D_1153').text === q), 'S_RFF/C_C506/D_1154').text;
  assert.strictEqual(ref(buyer, 'VA'), 'SI23456787');
  assert.strictEqual(ref(buyer, 'AHP'), '23456787', 'NBT-013 buyer tax number');
  assert.strictEqual(node(seller, 'S_FII/C_C078/D_3194').text, 'SI56191000000123438');
  assert.strictEqual(ref(seller, 'VA'), 'SI12345679');
  assert.strictEqual(node(m, 'G_SG8/S_DTM/C_C507/D_2380').text, '2026-10-16');
  const lines = all(m, 'G_SG26');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(node(lines[1], 'S_QTY/C_C186/D_6411').text, 'HUR');
  assert.strictEqual(node(lines[0], 'S_QTY/C_C186/D_6411').text, 'H87');
  assert.strictEqual(node(lines[1], 'G_SG27/S_MOA/C_C516/D_5004').text, '189.00');
  assert.strictEqual(node(lines[1], 'G_SG34/S_TAX/C_C243/D_5278').text, '9.5');
  // line net = qty × price − allowance (BT-131 = BT-129 × BT-146 − BT-136)
  const allowance = all(node(lines[1], 'G_SG39'), 'G_SG42').map((g) => node(g, 'S_MOA/C_C516/D_5004').text);
  assert.deepStrictEqual(allowance, ['21.00', '210.00']);
  const sums = all(m, 'G_SG50');
  const T = inv.snapshot.totals;
  assert.strictEqual(moaOf(sums, '79'), (T.net / 100).toFixed(2));
  assert.strictEqual(moaOf(sums, '389'), (T.net / 100).toFixed(2));
  assert.strictEqual(moaOf(sums, '176'), (T.vat / 100).toFixed(2));
  assert.strictEqual(moaOf(sums, '388'), (T.total / 100).toFixed(2));
  assert.strictEqual(moaOf(sums, '9'), (T.total / 100).toFixed(2));
  const lineSum = lines.reduce((a, l) => a + Math.round(Number(node(l, 'G_SG27/S_MOA/C_C516/D_5004').text) * 100), 0);
  assert.strictEqual(lineSum, T.net, 'sum of line nets = BT-106');
  const vat = all(m, 'G_SG52').map((g) => [node(g, 'S_TAX/C_C243/D_5278').text, node(g, 'S_TAX/D_5305').text, ...all(g, 'S_MOA').map((x) => node(x, 'C_C516/D_5004').text)]);
  assert.deepStrictEqual(vat, [['22', 'S', '1200.00', '264.00'], ['9.5', 'S', '189.00', '17.96']]);
  // the element order follows the schema sequence of M_INVOIC
  const order = ['S_UNH', 'S_BGM', 'S_DTM', 'S_FTX', 'G_SG1', 'G_SG2', 'G_SG7', 'G_SG8', 'G_SG26', 'S_UNS', 'G_SG50', 'G_SG52'];
  const seen = m.children.map((c) => order.indexOf(c.name));
  assert.ok(seen.every((x, k) => x >= 0 && (k === 0 || x >= seen[k - 1])), 'segments in schema order');
});

t('e-SLOG 2.0: credit note 381 with positive amounts and the original invoice; reverse charge and small taxpayer categories', () => {
  const s = newState();
  const inv = draft(s, 'lipa', [line('A', 2, 100)]);
  issue(s, inv, '2026-10-01');
  const cn = creditNote(s, inv, [line('A', -1, 100)], '2026-10-05');
  const m = node(B.parseXml(E.xml(cn.snapshot)).children[0], 'M_INVOIC');
  assert.strictEqual(node(m, 'S_BGM/C_C002/D_1001').text, '381');
  const oi = all(m, 'G_SG1').find((g) => node(g, 'S_RFF/C_C506/D_1153').text === 'OI');
  assert.strictEqual(node(oi, 'S_RFF/C_C506/D_1154').text, 'VZ-2026-0001');
  assert.strictEqual(node(oi, 'S_DTM/C_C507/D_2380').text, '2026-10-01');
  assert.strictEqual(node(m, 'G_SG26/S_QTY/C_C186/D_6060').text, '1');
  assert.strictEqual(moaOf(all(m, 'G_SG50'), '9'), '122.00');
  assert.ok(!node(m, 'G_SG8'), 'no payment terms on a credit note');
  // EU services: reverse charge AE with the VATEX code and the clause
  const eu = draft(s, 'bright', [line('Consulting', 1, 2500)]);
  issue(s, eu, '2026-10-06');
  const me = node(B.parseXml(E.xml(eu.snapshot)).children[0], 'M_INVOIC');
  const agm = all(me, 'S_FTX').find((f) => node(f, 'D_4451').text === 'AGM');
  assert.strictEqual(node(agm, 'C_C107/D_4441').text, 'VATEX-EU-AE');
  assert.match(node(agm, 'C_C108/D_4440').text, /Reverse charge/);
  assert.strictEqual(node(me, 'G_SG52/S_TAX/D_5305').text, 'AE');
  assert.strictEqual(node(me, 'G_SG52/S_TAX/C_C243/D_5278').text, '0');
  assert.strictEqual(E.category({ issuer: { vatRegistered: false }, clauses: ['x'], lang: 'sl' }).code, 'E');
  assert.strictEqual(E.category({ issuer: { vatRegistered: true }, treatment: 'export_services', clauses: [] }).code, 'O');
});

t('e-SLOG 2.0: problems block the export when the buyer has no tax number; helpers', () => {
  const s = newState();
  s.clients[2].taxNumber = '';
  const inv = draft(s, 'nimbus', [line('Audit', 1, 3200)]);
  issue(s, inv, '2026-10-01');
  const pr = E.problems(inv.snapshot);
  assert.ok(pr.errors.some((e) => /NBT-013/.test(e)));
  assert.ok(pr.warnings.some((w) => /check it with your e-invoicing provider/.test(w)));
  const ok = draft(s, 'lipa', [line('A', 1, 1)]);
  issue(s, ok, '2026-10-02');
  assert.deepStrictEqual(E.problems(ok.snapshot).errors, []);
  assert.deepStrictEqual(E.postCity('1000 Ljubljana'), { post: '1000', city: 'Ljubljana' });
  assert.deepStrictEqual(E.postCity('SI-2000 Maribor'), { post: 'SI-2000', city: 'Maribor' });
  assert.deepStrictEqual(E.postCity('San Francisco, CA 94105'), { post: '94105', city: 'San Francisco, CA' });
  assert.deepStrictEqual(E.addressLines('Ulica heroja Šaranoviča 1234, poslovna stavba B, 3. nadstropje, vhod levo'), ['Ulica heroja Šaranoviča 1234,', 'poslovna stavba B, 3. nadstropje,', 'vhod levo']);
  assert.strictEqual(E.unitCode('mes.'), 'MON');
  assert.strictEqual(E.unitCode('něco'), 'C62');
  const x = E.xml({ ...ok.snapshot, note: 'A & B <tag> "q"' });
  assert.ok(x.includes('A &amp; B &lt;tag&gt; &quot;q&quot;'));
});

t('compareCopies: finalised quotes and proformas count too, against their own counter', () => {
  const cloud = twoDevices();
  cloud.quotes = []; cloud.quoteCounters = {};
  const here = copy(cloud);
  const q = { id: 'q1', clientId: 'lipa', kind: 'quote', lines: [line('Ponudba', 1, 500)] };
  C.issueQuote(here, q, '2026-10-07');
  here.quotes.push(q);
  const cmp = C.compareCopies(here, cloud);
  assert.strictEqual(cmp.lost.length, 1);
  assert.strictEqual(cmp.lost[0].number, q.number);
  assert.strictEqual(cmp.lost[0].kind, 'quote');
  assert.strictEqual(cmp.reused.length, 1);                              // the cloud's quote counter is still 0
  assert.deepStrictEqual(C.compareCopies(here, copy(here)).lost, []);
  assert.deepStrictEqual(C.compareCopies({ invoices: [] }, {}).lost, []);   // copies saved before quotes existed
});

console.log(`\n${n} tests passed`);
