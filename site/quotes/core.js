/* Quotes core: pure rules, no DOM. Loaded by index.html, accept.html and the Node tests (tools/tests/quotes.test.js).
 *
 * Money is whole cents. The maths is the same as Billing's (site/billing/core.js computeTotals) on purpose, so a quote
 * and the invoice made from it always show the same totals to the cent:
 *   line amount = round(qty x unit price x (1 - line discount %) x 100)
 *   subtotal    = sum of the line amounts
 *   discount    = round(subtotal x overall discount % / 100)
 *   net         = subtotal - discount
 *   VAT         = round(net x VAT % / 100)           (one rate per quote, computed once on the net)
 *   total       = net + VAT
 */
(function (root) {
  'use strict';

  const STATUSES = ['draft', 'sent', 'accepted', 'expired', 'declined'];
  const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', expired: 'Expired', declined: 'Declined' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- dates (ISO yyyy-mm-dd, local day) ----------
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addDays = (iso, n) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(n || 0));
    return d.toISOString().slice(0, 10);
  };
  const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
  // "14 Nov 2026"
  const dmy = (iso) => (isIso(iso) ? `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '—');

  // ---------- money ----------
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const cents = (v) => Math.round(num(v) * 100);
  // 1234567 -> "12.345,67 €" (thousands dots, decimal comma, as on Slovenian documents; negative with a real minus)
  function eur(c, { plain = false } = {}) {
    const n = Math.round(num(c));
    const neg = n < 0, a = Math.abs(n);
    const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const s = `${whole},${pad(a % 100)}`;
    return `${neg ? '−' : ''}${s}${plain ? '' : ' €'}`;
  }
  const pct = (v) => `${String(num(v)).replace('.', ',')} %`;

  // ---------- totals ----------
  const lineAmount = (l) => Math.round(num(l.qty) * num(l.unitPrice) * (1 - num(l.discountPct) / 100) * 100);
  function totals(q) {
    const lines = (q.lines || []).map((l) => ({ ...l, amount: lineAmount(l) }));
    const subtotal = lines.reduce((a, l) => a + l.amount, 0);
    const discount = Math.round(subtotal * num(q.discountPct) / 100);
    const net = subtotal - discount;
    const vat = Math.round(net * num(q.vatPct) / 100);
    return { lines, subtotal, discount, net, vat, total: net + vat };
  }

  // ---------- status ----------
  // Expired is not stored: a quote that was sent and whose "valid until" day has passed is shown as Expired.
  // (The valid-until day itself still counts as valid.)
  function statusOf(q, today = todayIso()) {
    if (q.status === 'sent' && isIso(q.validUntil) && q.validUntil < today) return 'expired';
    return q.status;
  }
  const isExpired = (q, today = todayIso()) => statusOf(q, today) === 'expired';

  // The client may only answer a quote that is out for decision, and only until it expires.
  function applyDecision(q, decision, today = todayIso()) {
    if (!q || !decision) return { ok: false, reason: 'No such quote.' };
    if (decision.kind !== 'accepted' && decision.kind !== 'declined') return { ok: false, reason: 'Unknown answer.' };
    const st = statusOf(q, today);
    if (st === 'expired') return { ok: false, reason: 'This quote has expired.' };
    if (st !== 'sent') return { ok: false, reason: `This quote is ${STATUS_LABEL[st] ? STATUS_LABEL[st].toLowerCase() : st}, so it cannot be answered.` };
    q.status = decision.kind;
    q.decision = {
      kind: decision.kind,
      name: String(decision.name || '').slice(0, 80),
      note: String(decision.note || '').slice(0, 500),
      at: String(decision.at || today).slice(0, 10),
    };
    return { ok: true };
  }

  // ---------- numbering ----------
  const numberOf = (year, seq) => `Q-${year}-${pad(seq, 3)}`;
  function nextNumber(quotes, year) {
    const seqs = (quotes || []).filter((q) => q.year === year).map((q) => num(q.seq));
    const seq = (seqs.length ? Math.max(...seqs) : 0) + 1;
    return { number: numberOf(year, seq), year, seq };
  }

  // ---------- list, tabs and KPIs ----------
  function counts(quotes, today = todayIso()) {
    const c = { all: quotes.length };
    for (const s of STATUSES) c[s] = 0;
    for (const q of quotes) c[statusOf(q, today)]++;
    return c;
  }
  function kpis(quotes, today = todayIso()) {
    const ym = today.slice(0, 7);
    let open = 0, openCount = 0, accepted = 0, acceptedCount = 0, won = 0, decided = 0;
    for (const q of quotes) {
      const st = statusOf(q, today), t = totals(q).total;
      if (st === 'sent') { open += t; openCount++; }
      if (st === 'accepted') {
        won++; decided++;
        if (q.decision && String(q.decision.at).slice(0, 7) === ym) { accepted += t; acceptedCount++; }
      }
      if (st === 'declined' || st === 'expired') decided++;
    }
    return { open, openCount, accepted, acceptedCount, rate: decided ? Math.round(won / decided * 100) : null, decided };
  }

  // ---------- quote -> Billing invoice draft ----------
  // The draft that "Create invoice in Billing" stores in Billing's own data (state.invoices, no number yet: Billing
  // numbers and freezes an invoice only when you issue it there). Billing lines carry a per-line discount and a VAT rate
  // but no document-wide discount, so the overall discount becomes one negative line "Discount x %" with the same VAT
  // rate; Billing then computes exactly the quote's net, VAT and total.
  function invoiceDraftFromQuote(q, { today = todayIso() } = {}) {
    const t = totals(q);
    const vatRate = num(q.vatPct);
    const lines = (q.lines || []).map((l) => ({
      description: String(l.description || ''), qty: num(l.qty), unit: '', unitPrice: num(l.unitPrice),
      discountPct: num(l.discountPct), vatRate,
    }));
    if (t.discount > 0) {
      lines.push({ description: `Discount ${String(num(q.discountPct)).replace('.', ',')} %`, qty: 1, unit: '', unitPrice: -t.discount / 100, discountPct: 0, vatRate });
    }
    return {
      kind: 'invoice', treatment: 'domestic', lang: 'en',
      supplyFrom: today, supplyTo: '', paymentDays: 15,
      note: `As per quote ${q.number}`, fromQuote: q.id, lines,
    };
  }

  // ---------- the client's link (accept.html#q=...) ----------
  // The whole quote travels inside the link (base64url of compact JSON in the fragment, which browsers never send to a
  // server). Only what the client page shows is included: no internal notes, no ids of other quotes.
  const MAX_LINES = 60;
  function sharePayload(q, company) {
    return {
      v: 1, id: q.id, n: q.number, subj: q.subject || '', issue: q.issueDate, valid: q.validUntil,
      vat: num(q.vatPct), disc: num(q.discountPct), st: q.status,
      from: { name: company.name, addr: company.address, city: company.city },
      to: { name: q.client.name, addr: q.client.address, city: q.client.city },
      lines: (q.lines || []).map((l) => [String(l.description || ''), String(l.note || ''), num(l.qty), num(l.unitPrice), num(l.discountPct)]),
      terms: q.terms || '',
    };
  }
  const b64uEncode = (str, B = root.Buffer) => {
    if (B) return B.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const bytes = new TextEncoder().encode(str);
    let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const b64uDecode = (txt, B = root.Buffer) => {
    const b = String(txt).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b + '='.repeat((4 - (b.length % 4)) % 4);
    if (B) return B.from(padded, 'base64').toString('utf8');
    const bin = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };
  const encodeShare = (q, company) => b64uEncode(JSON.stringify(sharePayload(q, company)));
  // Returns a clean quote-shaped object, or null when the link is damaged or does not look like a quote.
  function decodeShare(txt) {
    let p;
    try { p = JSON.parse(b64uDecode(txt)); } catch (e) { return null; }
    if (!p || typeof p !== 'object' || p.v !== 1 || !Array.isArray(p.lines) || p.lines.length > MAX_LINES) return null;
    const s = (v, n = 200) => String(v == null ? '' : v).slice(0, n);
    const party = (x) => ({ name: s(x && x.name, 120), address: s(x && x.addr, 120), city: s(x && x.city, 120) });
    const from = party(p.from), to = party(p.to);
    const q = {
      id: s(p.id, 64), number: s(p.n, 40), subject: s(p.subj, 160), issueDate: isIso(p.issue) ? p.issue : '', validUntil: isIso(p.valid) ? p.valid : '',
      vatPct: Math.min(100, Math.max(0, num(p.vat))), discountPct: Math.min(100, Math.max(0, num(p.disc))), status: s(p.st, 20),
      terms: s(p.terms, 600),
      company: { name: from.name, address: from.address, city: from.city },
      client: { name: to.name, address: to.address, city: to.city },
      lines: p.lines.map((l) => (Array.isArray(l) ? { description: s(l[0], 200), note: s(l[1], 300), qty: num(l[2]), unitPrice: num(l[3]), discountPct: Math.min(100, Math.max(0, num(l[4]))) } : null)).filter(Boolean),
    };
    if (!q.id || !q.number || !q.lines.length) return null;
    return q;
  }
  // The client's answer travels back the same way (reply link), for when the owner is on another device.
  function encodeReply(r) { return b64uEncode(JSON.stringify({ v: 1, id: r.id, kind: r.kind, name: r.name || '', note: r.note || '', at: r.at })); }
  function decodeReply(txt) {
    let p;
    try { p = JSON.parse(b64uDecode(txt)); } catch (e) { return null; }
    if (!p || p.v !== 1 || (p.kind !== 'accepted' && p.kind !== 'declined') || typeof p.id !== 'string' || !isIso(p.at)) return null;
    return { id: p.id.slice(0, 64), kind: p.kind, name: String(p.name || '').slice(0, 80), note: String(p.note || '').slice(0, 500), at: p.at };
  }

  // ---------- demo data ----------
  const COMPANY = { name: 'Lipa Studio d.o.o.', address: 'Trubarjeva cesta 5', city: '1000 Ljubljana' };
  const L = (description, note, qty, unitPrice, discountPct = 0) => ({ description, note, qty, unitPrice, discountPct });
  // Day offsets are relative to the day the demo is made (DemoDates keeps them current afterwards).
  function seedQuotes(today = todayIso()) {
    const d = (n) => addDays(today, n);
    const mk = (seq, client, subject, status, issue, valid, vatPct, discountPct, lines, extra = {}) => ({
      id: `demo-q-${seq}`, number: numberOf(2026, seq), year: 2026, seq, subject, status, client, issueDate: d(issue), validUntil: d(valid),
      vatPct, discountPct, lines, terms: 'Payment within 15 days of the invoice. Prices in EUR.', ...extra,
    });
    const accepted = (daysAgo, name) => ({ decision: { kind: 'accepted', name, note: '', at: d(daysAgo) } });
    return [
      mk(14, { name: 'Pekarna Zlato d.o.o.', address: 'Cesta v Mestni log 12', city: '1000 Ljubljana' }, 'Brand, website and shop', 'sent', -2, 28, 22, 5, [
        L('Brand refresh and logo system', 'Logo, colours, type, one-page guide', 1, 2400),
        L('Website design, 8 pages', 'Responsive layouts in Figma', 1, 3600, 10),
        L('Online shop setup', 'Catalogue, checkout, delivery rules', 1, 1800),
        L('Product photography', 'Half-day sessions, 20 edited photos each', 3, 420),
        L('Hosting and care plan', 'Per month, 12 months', 12, 45),
      ], { sentAt: d(-2) }),
      mk(13, { name: 'Kavarna Brin d.o.o.', address: 'Glavni trg 3', city: '2000 Maribor' }, 'Menu redesign', 'accepted', -9, 21, 22, 0, [
        L('Menu layout and print files', 'A4 menu, two languages', 1, 900),
        L('Allergen icon set', 'Fourteen icons, SVG and PNG', 1, 300),
      ], { sentAt: d(-9), ...accepted(-5, 'Maja Brin') }),
      mk(12, { name: 'Vrt Zadruga z.o.o.', address: 'Kmetijska ulica 8', city: '3000 Celje' }, 'Packaging labels', 'draft', -1, 29, 22, 0, [
        L('Label design, 3 variants', 'One per jar size', 3, 600),
        L('Print-ready artwork and proofs', '', 1, 700),
      ]),
      mk(11, { name: 'Optika Luna d.o.o.', address: 'Mestni trg 21', city: '4000 Kranj' }, 'Website care plan', 'sent', -47, -17, 22, 0, [
        L('Website care plan', 'Updates, backups, small edits; per month', 6, 150),
      ], { sentAt: d(-47) }),
      mk(10, { name: 'Sladoled Polar d.o.o.', address: 'Obalna cesta 14', city: '6000 Koper' }, 'Seasonal campaign', 'declined', -20, 10, 22, 0, [
        L('Campaign concept and key visual', '', 1, 1800),
        L('Social media assets', 'Eight formats', 8, 250),
        L('Posters', 'A2, print-ready', 3, 200),
      ], { sentAt: d(-20), decision: { kind: 'declined', name: 'Jure Polar', note: 'Budget for this season is already used.', at: d(-12) } }),
      mk(9, { name: 'Mlin Jerič d.o.o.', address: 'Mlinska pot 2', city: '9000 Murska Sobota' }, 'Photo shoot', 'accepted', -14, 16, 22, 0, [
        L('Studio photo shoot, full day', 'Products and team portraits', 1, 1200),
        L('Retouching', 'Per edited photo', 20, 25),
      ], { sentAt: d(-14), ...accepted(-9, 'Ana Jerič') }),
    ];
  }

  const api = {
    STATUSES, STATUS_LABEL, COMPANY,
    todayIso, addDays, isIso, dmy, cents, eur, pct, lineAmount, totals,
    statusOf, isExpired, applyDecision, numberOf, nextNumber, counts, kpis,
    invoiceDraftFromQuote, sharePayload, encodeShare, decodeShare, encodeReply, decodeReply, b64uEncode, b64uDecode, seedQuotes,
  };
  root.QuotesCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
