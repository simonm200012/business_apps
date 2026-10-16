/* Collections bank statements (Business Apps): read a bank statement and match the incoming payments to open
 * invoices. Pure functions, no DOM. UMD, so it also loads in Node (tests: tools/tests/collections-bank.test.js).
 *
 * Formats:
 * - ISO 20022 camt.053 (BankToCustomerStatement, versions .001.02 to .001.13): every booked credit entry, and every
 *   transaction inside a batched entry (NtryDtls/TxDtls). Namespace prefixes are ignored. Source: ISO 20022 message
 *   definition camt.053, https://www.iso20022.org/iso-20022-message-definitions (Bank-to-Customer Cash Management),
 *   and the Slovenian/Croatian bank implementations of it (Združenje bank Slovenije, SEPA camt.053 guidelines).
 * - A bank's CSV export, with column mapping (the same CSV reader as the open-items import).
 *
 * Matching, best first:
 *   1. the payment reference (sklic / poziv na broj): model SI or HR + the invoice number's digits, as the letters and
 *      Billing print it (engine.paymentReference), also RF creditor references (ISO 11649) and the invoice number
 *      written in the purpose text;
 *   2. the payer: a bank account learned from an earlier payment, or the payer's name, plus the amount (one invoice
 *      or the oldest invoices adding up to it);
 *   3. the amount alone, when exactly one open invoice has it (never pre-selected).
 * A payment goes first to the invoice its reference names, then to the customer's other open invoices, oldest first;
 * what is left over is reported and not applied. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.CollBank = factory(root.CollEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var EPS = 0.005;

  // ── a small XML reader (enough for bank statements: elements, attributes, text, CDATA, entities) ──
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, k) {
      var l = k.toLowerCase();
      if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'quot') return '"'; if (l === 'apos') return "'";
      var n = l.charAt(1) === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return isFinite(n) ? String.fromCodePoint(n) : m;
    });
  }
  /** XML text → tree of { name (without namespace prefix), attrs, children, text }. Throws on broken nesting. */
  function parseXml(text) {
    var s = String(text == null ? '' : text).replace(/^﻿/, ''), i = 0, n = s.length;
    var rootEl = { name: '#root', attrs: {}, children: [], text: '' }, stack = [rootEl];
    while (i < n) {
      var lt = s.indexOf('<', i);
      if (lt < 0) { stack[stack.length - 1].text += decodeEntities(s.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += decodeEntities(s.slice(i, lt));
      if (s.startsWith('<!--', lt)) { var ce = s.indexOf('-->', lt + 4); i = ce < 0 ? n : ce + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { var de = s.indexOf(']]>', lt + 9); stack[stack.length - 1].text += s.slice(lt + 9, de < 0 ? n : de); i = de < 0 ? n : de + 3; continue; }
      if (s.charAt(lt + 1) === '?' || s.charAt(lt + 1) === '!') { var pe = s.indexOf('>', lt); i = pe < 0 ? n : pe + 1; continue; }
      var gt = lt, q = null;
      for (gt = lt + 1; gt < n; gt++) { var ch = s.charAt(gt); if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
      if (gt >= n) throw new Error('The XML ends inside a tag.');
      var tag = s.slice(lt + 1, gt);
      i = gt + 1;
      if (tag.charAt(0) === '/') {
        var cn = tag.slice(1).trim().replace(/^[\w.-]+:/, ''), top = stack.pop();
        if (!top || top.name !== cn) throw new Error('The XML is not well formed near </' + cn + '>.');
        continue;
      }
      var self = /\/\s*$/.test(tag); if (self) tag = tag.replace(/\/\s*$/, '');
      var m = /^([\w.:-]+)/.exec(tag); if (!m) throw new Error('The XML has a broken tag.');
      var el = { name: m[1].replace(/^[\w.-]+:/, ''), attrs: {}, children: [], text: '' };
      tag.slice(m[1].length).replace(/([\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, function (x, k, v, a, b) { el.attrs[k.replace(/^[\w.-]+:/, '')] = decodeEntities(a != null ? a : b); return ''; });
      stack[stack.length - 1].children.push(el);
      if (!self) stack.push(el);
    }
    if (stack.length > 1) throw new Error('The XML ends before <' + stack[stack.length - 1].name + '> is closed.');
    return rootEl;
  }
  function kids(el, name) { return el ? el.children.filter(function (c) { return c.name === name; }) : []; }
  /** the first element along a path such as 'Refs/EndToEndId' */
  function at(el, path) {
    var p = path.split('/'), cur = el;
    for (var k = 0; k < p.length && cur; k++) cur = kids(cur, p[k])[0] || null;
    return cur;
  }
  function txt(el, path) { var x = path ? at(el, path) : el; return x ? x.text.replace(/\s+/g, ' ').trim() : ''; }
  function allText(el, path) { var p = path.split('/'), last = p.pop(), base = p.length ? at(el, p.join('/')) : el; return kids(base, last).map(function (x) { return txt(x); }).filter(Boolean); }
  function find(el, name) { if (!el) return null; if (el.name === name) return el; for (var k = 0; k < el.children.length; k++) { var r = find(el.children[k], name); if (r) return r; } return null; }

  // ── camt.053 ─────────────────────────────────────────────────────────────
  /** ISO 20022 amounts always use a full stop and no thousands separator: 1234.56 */
  function camtAmount(s) { s = String(s || '').trim(); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; }
  function isoDay(s) { s = String(s || '').trim(); return E.isDate(s.slice(0, 10)) ? s.slice(0, 10) : ''; }
  function party(el, role) {
    // camt.053.001.02: RltdPties/Dbtr/Nm; .001.08 and later: RltdPties/Dbtr/Pty/Nm
    var p = at(el, 'RltdPties/' + role); if (!p) return '';
    return txt(p, 'Nm') || txt(p, 'Pty/Nm');
  }
  function account(el, role) { var a = at(el, 'RltdPties/' + role + 'Acct/Id'); return a ? (txt(a, 'IBAN') || txt(a, 'Othr/Id')).replace(/\s+/g, '').toUpperCase() : ''; }
  /** camt.053 XML → { format, statements: [{ id, iban, from, to, created }], entries: [...] }. Each entry is one
   * payment: { id, date, valueDate, amount, currency, credit, reversal, booked, name, iban, refs, text, bankRef }. */
  function parseCamt053(xml) {
    var doc = parseXml(xml), stmtRoot = find(doc, 'BkToCstmrStmt');
    if (!stmtRoot) {
      if (find(doc, 'BkToCstmrDbtCdtNtfctn') || find(doc, 'BkToCstmrAcctRpt')) throw new Error('This is a camt.054 or camt.052 file. Export the daily statement (camt.053) instead.');
      throw new Error('This is not a camt.053 bank statement (no BkToCstmrStmt element).');
    }
    var out = { format: 'camt.053', statements: [], entries: [] }, seq = 0;
    kids(stmtRoot, 'Stmt').forEach(function (st) {
      var acct = txt(st, 'Acct/Id/IBAN') || txt(st, 'Acct/Id/Othr/Id');
      out.statements.push({ id: txt(st, 'Id'), iban: acct.replace(/\s+/g, '').toUpperCase(), from: isoDay(txt(st, 'FrToDt/FrDtTm')), to: isoDay(txt(st, 'FrToDt/ToDtTm')), created: isoDay(txt(st, 'CreDtTm')) });
      kids(st, 'Ntry').forEach(function (ny) {
        var amtEl = at(ny, 'Amt'), amount = amtEl ? camtAmount(amtEl.text) : NaN;
        var cur = amtEl ? amtEl.attrs.Ccy || '' : '', credit = txt(ny, 'CdtDbtInd') === 'CRDT';
        var sts = txt(ny, 'Sts/Cd') || txt(ny, 'Sts'), booked = !sts || sts === 'BOOK';
        var date = isoDay(txt(ny, 'BookgDt/Dt') || txt(ny, 'BookgDt/DtTm')) || isoDay(txt(ny, 'ValDt/Dt') || txt(ny, 'ValDt/DtTm'));
        var valueDate = isoDay(txt(ny, 'ValDt/Dt') || txt(ny, 'ValDt/DtTm')) || date;
        var reversal = txt(ny, 'RvslInd') === 'true';
        var ntryRef = txt(ny, 'AcctSvcrRef') || txt(ny, 'NtryRef'), info = txt(ny, 'AddtlNtryInf');
        var txs = [];
        kids(ny, 'NtryDtls').forEach(function (d) { kids(d, 'TxDtls').forEach(function (t) { txs.push(t); }); });
        if (!txs.length) txs = [null];
        txs.forEach(function (t, k) {
          var tAmtEl = t ? at(t, 'AmtDtls/TxAmt/Amt') || at(t, 'Amt') || at(t, 'AmtDtls/InstdAmt/Amt') : null;
          var tAmt = tAmtEl ? camtAmount(tAmtEl.text) : NaN;
          var tCredit = t && txt(t, 'CdtDbtInd') ? txt(t, 'CdtDbtInd') === 'CRDT' : credit;
          var refs = [], texts = [];
          if (t) {
            kids(at(t, 'RmtInf'), 'Strd').forEach(function (sd) { var r = txt(sd, 'CdtrRefInf/Ref'); if (r) refs.push(r); allText(sd, 'AddtlRmtInf').forEach(function (x) { texts.push(x); }); });
            allText(t, 'RmtInf/Ustrd').forEach(function (x) { texts.push(x); });
            var e2e = txt(t, 'Refs/EndToEndId'); if (e2e && e2e !== 'NOTPROVIDED') refs.push(e2e);
            var ati = txt(t, 'AddtlTxInf'); if (ati) texts.push(ati);
          }
          if (info) texts.push(info);
          var bankRef = (t && (txt(t, 'Refs/AcctSvcrRef') || txt(t, 'Refs/TxId'))) || (ntryRef ? ntryRef + (txs.length > 1 ? '/' + (k + 1) : '') : '');
          out.entries.push({
            seq: ++seq, date: date, valueDate: valueDate, amount: E.round2(isFinite(tAmt) && txs.length > 1 ? tAmt : isFinite(amount) ? amount : tAmt),
            currency: (tAmtEl && tAmtEl.attrs.Ccy) || cur, credit: tCredit, reversal: reversal, booked: booked,
            name: t ? party(t, tCredit ? 'Dbtr' : 'Cdtr') || party(t, 'UltmtDbtr') : '', iban: t ? account(t, tCredit ? 'Dbtr' : 'Cdtr') : '',
            refs: refs, text: texts.join(' · '), bankRef: bankRef, purpose: t ? txt(t, 'Purp/Cd') : ''
          });
        });
      });
    });
    out.entries.forEach(function (x) { x.id = entryId(x); });
    return out;
  }

  // ── bank CSV ─────────────────────────────────────────────────────────────
  var BANK_FIELDS = [
    { id: 'date', label: 'Booking date', required: true, hints: ['booking date', 'datum knjiženja', 'datum knjizenja', 'datum izvršitve', 'datum izvrsitve', 'datum', 'date', 'datum valute', 'value date', 'datum transakcije', 'datum izvršenja'] },
    { id: 'amount', label: 'Amount (+ in, − out)', hints: ['amount', 'znesek', 'iznos', 'value'] },
    { id: 'credit', label: 'Money in (credit)', hints: ['dobro', 'v dobro', 'priliv', 'prilivi', 'credit', 'uplata', 'potražuje', 'potrazuje', 'in'] },
    { id: 'debit', label: 'Money out (debit)', hints: ['breme', 'v breme', 'odliv', 'odlivi', 'debit', 'isplata', 'duguje', 'out'] },
    { id: 'name', label: 'Payer', hints: ['plačnik', 'placnik', 'naziv plačnika', 'payer', 'platitelj', 'nalogodavac', 'partner', 'naziv', 'name', 'counterparty', 'prejemnik/plačnik'] },
    { id: 'iban', label: "Payer's account (IBAN)", hints: ['iban plačnika', 'račun plačnika', 'racun placnika', 'iban', 'account', 'račun', 'racun', 'trr'] },
    { id: 'reference', label: 'Reference', hints: ['sklic', 'sklic prejemnika', 'referenca', 'poziv na broj', 'poziv na broj primatelja', 'reference', 'ref'] },
    { id: 'text', label: 'Purpose / description', hints: ['namen', 'namen plačila', 'opis', 'opis plaćanja', 'purpose', 'description', 'details', 'detalji'] },
    { id: 'currency', label: 'Currency', hints: ['valuta plačila', 'currency', 'ccy', 'valuta'] }
  ];
  /** CSV rows (header first) + mapping → { entries, errors, warnings }, like the camt reader */
  function parseBankCsv(rows, mapping) {
    var errors = [], warnings = [], entries = [], seq = 0;
    if (!(mapping.date >= 0)) errors.push({ line: 0, msg: 'Choose the column for "Booking date".' });
    if (!(mapping.amount >= 0) && !(mapping.credit >= 0)) errors.push({ line: 0, msg: 'Choose the column for the amount, or for money in (credit).' });
    if (errors.length) return { format: 'csv', entries: entries, errors: errors, warnings: warnings };
    function get(r, k) { return mapping[k] >= 0 ? String(r[mapping[k]] == null ? '' : r[mapping[k]]).trim() : ''; }
    rows.slice(1).forEach(function (r, i) {
      var line = i + 2, d = E.parseDate(get(r, 'date')), amt;
      if (mapping.credit >= 0 && get(r, 'credit') !== '') amt = E.parseNumber(get(r, 'credit'));
      else if (mapping.debit >= 0 && get(r, 'debit') !== '') amt = -Math.abs(E.parseNumber(get(r, 'debit')));
      else amt = E.parseNumber(get(r, 'amount'));
      if (!get(r, 'date') || (!d && !isFinite(amt))) return; // a sum line, a heading or a blank line
      if (!d) { errors.push({ line: line, msg: 'Row ' + line + ': "' + get(r, 'date') + '" is not a date.' }); return; }
      if (!isFinite(amt)) { errors.push({ line: line, msg: 'Row ' + line + ': the amount is not a number.' }); return; }
      var ref = get(r, 'reference');
      entries.push({ seq: ++seq, line: line, date: d, valueDate: d, amount: E.round2(Math.abs(amt)), currency: (get(r, 'currency') || 'EUR').toUpperCase().slice(0, 3), credit: amt > 0, reversal: false, booked: true,
        name: get(r, 'name'), iban: get(r, 'iban').replace(/\s+/g, '').toUpperCase(), refs: ref ? [ref] : [], text: get(r, 'text'), bankRef: '', purpose: '' });
    });
    if (!rows.length || rows.length < 2) errors.push({ line: 0, msg: 'The file has no rows under the header.' });
    entries.forEach(function (x) { x.id = entryId(x); });
    return { format: 'csv', entries: entries, errors: errors, warnings: warnings };
  }

  /** a stable id for one payment, so importing the same statement twice skips what is already recorded */
  function entryId(x) {
    if (x.bankRef) return 'b:' + x.bankRef;
    var s = [x.date, x.amount.toFixed(2), x.iban, (x.refs || []).join(','), x.name, x.text].join('|'), h = 2166136261;
    for (var k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
    return 'h:' + (h >>> 0).toString(36) + ':' + x.date + ':' + x.amount.toFixed(2);
  }

  // ── references ───────────────────────────────────────────────────────────
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  /** every way a reference can name an invoice: model SI/HR + body, RF + body, or bare digits */
  function refKeys(raw) {
    var s = String(raw || '').toUpperCase().replace(/\s+/g, ''), out = [], body = '';
    var m = /^(SI|HR)(\d{2})([0-9A-Z-]{1,26})$/.exec(s), rf = /^RF\d{2}([0-9A-Z]{1,21})$/.exec(s);
    if (m) body = m[3]; else if (rf) body = rf[1]; else if (/^[0-9-]{4,}$/.test(s)) body = s; else return out;
    var d = digits(body); if (d.length >= 3) out.push(d);
    var seg = body.split('-').filter(Boolean);
    seg.forEach(function (x) { var y = digits(x); if (y.length >= 4 && out.indexOf(y) < 0) out.push(y); });
    for (var k = 0; k + 1 < seg.length; k++) { var j = digits(seg[k] + seg[k + 1]); if (j.length >= 5 && out.indexOf(j) < 0) out.push(j); }
    return out;
  }
  /** references found in free text: "SI00 2026-001234", "HR00 2026-1234", "RF18 ..." */
  function refsInText(t) {
    var out = [], re = /\b(SI|HR)\s?(\d{2})\s?([0-9][0-9 -]{2,24}[0-9])\b|\bRF\d{2}\s?[0-9A-Z ]{1,25}\b/gi, m;
    t = String(t || '');
    while ((m = re.exec(t))) out.push(m[0].replace(/\s+/g, '').replace(/^(SI|HR)(\d{2})/i, function (x) { return x.toUpperCase(); }));
    return out;
  }

  // ── names ────────────────────────────────────────────────────────────────
  var LEGAL = /\b(d\.?\s?o\.?\s?o|j\.?\s?d\.?\s?o\.?\s?o|d\.?\s?d|s\.?\s?p|d\.?\s?n\.?\s?o|k\.?\s?d|obrt|gmbh|srl|s\.?r\.?l|ltd|llc|ag|kg|doo|dd|sp)\b\.?/g;
  function nameTokens(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
      .replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (w) { return w.length >= 3; });
  }
  /** 0–1: how well a payer's name fits a customer's name (shared words over the shorter name) */
  function nameScore(a, b) {
    var A = nameTokens(a), B = nameTokens(b); if (!A.length || !B.length) return 0;
    var hit = 0; A.forEach(function (w) { if (B.indexOf(w) >= 0 || B.some(function (v) { return v.length >= 5 && w.length >= 5 && (v.indexOf(w) === 0 || w.indexOf(v) === 0); })) hit++; });
    return hit / Math.min(A.length, B.length) * (hit >= 1 ? 1 : 0) * (Math.min(A.length, B.length) === 1 && Math.max(A.length, B.length) > 2 ? 0.8 : 1);
  }

  // ── matching ─────────────────────────────────────────────────────────────
  /** Index the open invoices of a Collections document for matching. */
  function matchIndex(db, today) {
    var ix = { byKey: {}, open: [], openBy: {}, cust: {}, byIban: {}, seen: {}, invNos: [] };
    (db.customers || []).forEach(function (c) {
      ix.cust[c.id] = c; ix.openBy[c.id] = [];
      (c.bankAccounts || []).forEach(function (a) { ix.byIban[String(a).replace(/\s+/g, '').toUpperCase()] = c.id; });
    });
    (db.invoices || []).forEach(function (inv) {
      (inv.payments || []).forEach(function (p) { if (p.bankId) ix.seen[p.bankId] = 1; });
      var o = E.openAt(inv, today); if (o <= 0) return;
      ix.open.push(inv); (ix.openBy[inv.customerId] = ix.openBy[inv.customerId] || []).push(inv);
      var d = digits(inv.no);
      if (d.length >= 3) (ix.byKey[d] = ix.byKey[d] || []).push(inv);
      if (String(inv.no).length >= 5) ix.invNos.push(inv);
    });
    Object.keys(ix.openBy).forEach(function (k) { ix.openBy[k].sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.no < b.no ? -1 : 1; }); });
    (db.bankSeen || []).forEach(function (id) { ix.seen[id] = 1; });
    return ix;
  }
  /** spread `amount` over a customer's open invoices: the named ones first, then the rest oldest first.
   * Disputed invoices are used only when the reference names them. */
  function allocFor(ix, custId, amount, firstIds, today) {
    var list = ix.openBy[custId] || [], first = firstIds || [], order = [];
    first.forEach(function (id) { var inv = list.filter(function (i) { return i.id === id; })[0]; if (inv) order.push(inv); });
    list.forEach(function (i) { if (order.indexOf(i) < 0 && !i.disputed) order.push(i); });
    var left = E.round2(amount), parts = [];
    order.forEach(function (inv) {
      if (left <= EPS) return;
      var o = E.openAt(inv, today); if (o <= 0) return;
      var x = E.round2(Math.min(o, left)); parts.push({ invoiceId: inv.id, no: inv.no, amount: x, open: o, full: x >= o - EPS }); left = E.round2(left - x);
    });
    return { parts: parts, rest: left > EPS ? left : 0 };
  }
  /** the oldest-first run of a customer's open invoices that adds up exactly to `amount`, or one invoice with exactly that open amount */
  function exactFit(ix, custId, amount, today) {
    var list = (ix.openBy[custId] || []).filter(function (i) { return !i.disputed; });
    var one = list.filter(function (i) { return Math.abs(E.openAt(i, today) - amount) < EPS; })[0];
    if (one) return [one.id];
    var s = 0, ids = [];
    for (var k = 0; k < list.length; k++) { s = E.round2(s + E.openAt(list[k], today)); ids.push(list[k].id); if (Math.abs(s - amount) < EPS) return ids; if (s > amount) break; }
    return null;
  }
  /** Match every incoming payment. Returns rows the review screen shows:
   * { entry, status: 'match' | 'none' | 'out' | 'dup' | 'currency' | 'pending', how, level: 'high' | 'medium' | 'low',
   *   customerId, invoiceIds (named by the reference), parts, rest, notes ([{ code: 'name' | 'multi' | 'nothing' | 'amountOnly' |
   *   'rest', n, amount }]), selected } */
  function matchEntries(entries, db, today) {
    var ix = matchIndex(db, today), rows = [], batch = {};
    entries.forEach(function (x) {
      var row = { entry: x, status: 'none', how: '', level: '', customerId: null, invoiceIds: [], parts: [], rest: 0, notes: [], selected: false };
      rows.push(row);
      if (!x.credit || x.reversal) { row.status = 'out'; return; }
      if (!x.booked) { row.status = 'pending'; return; }
      if (ix.seen[x.id] || batch[x.id]) { row.status = 'dup'; return; }
      batch[x.id] = 1;
      if (x.currency && x.currency !== 'EUR') { row.status = 'currency'; return; }
      if (!(x.amount > 0)) { row.status = 'out'; return; }
      // 1. reference
      var refs = (x.refs || []).concat(refsInText(x.text)), hits = [];
      refs.forEach(function (r) { refKeys(r).forEach(function (k) { (ix.byKey[k] || []).forEach(function (inv) { if (hits.indexOf(inv) < 0) hits.push(inv); }); }); });
      if (!hits.length && x.text) {
        var T = ' ' + String(x.text).toUpperCase() + ' ';
        ix.invNos.forEach(function (inv) { var no = String(inv.no).toUpperCase(), p = T.indexOf(no); if (p > 0 && !/[0-9A-Z]/.test(T.charAt(p - 1)) && !/[0-9A-Z]/.test(T.charAt(p + no.length))) hits.push(inv); });
      }
      var hitCust = {}; hits.forEach(function (inv) { hitCust[inv.customerId] = 1; });
      var hc = Object.keys(hitCust);
      if (hits.length && hc.length > 1 && x.name) {
        // the same digits on invoices of several customers: keep the one the payer's name fits
        var best = hc.map(function (id) { return { id: id, s: nameScore(x.name, ix.cust[id].name) }; }).sort(function (a, b) { return b.s - a.s; })[0];
        if (best.s >= 0.5) { hits = hits.filter(function (inv) { return inv.customerId === best.id; }); hc = [best.id]; }
      }
      if (hits.length && hc.length === 1) {
        row.status = 'match'; row.how = 'reference'; row.level = 'high'; row.customerId = hc[0];
        row.invoiceIds = hits.map(function (i) { return i.id; });
        if (x.name && nameScore(x.name, ix.cust[hc[0]].name) < 0.34) row.notes.push({ code: 'name' });
      } else if (hits.length) row.notes.push({ code: 'multi', n: hc.length });
      // 2. the payer's account or name
      if (row.status !== 'match') {
        var cid = x.iban && ix.byIban[x.iban] ? ix.byIban[x.iban] : null, how = cid ? 'account' : '';
        if (!cid && x.name) {
          var sc = Object.keys(ix.cust).map(function (id) { return { id: id, s: nameScore(x.name, ix.cust[id].name) }; }).filter(function (o) { return o.s >= 0.6; }).sort(function (a, b) { return b.s - a.s; });
          if (sc.length && (sc.length === 1 || sc[0].s > sc[1].s + 0.15)) { cid = sc[0].id; how = 'name'; }
        }
        if (cid) {
          var fit = exactFit(ix, cid, x.amount, today);
          row.status = 'match'; row.customerId = cid; row.how = how + (fit ? '+amount' : '');
          row.level = fit ? (how === 'account' ? 'high' : 'medium') : 'low';
          row.invoiceIds = fit || [];
          if (!(ix.openBy[cid] || []).length) { row.notes.push({ code: 'nothing' }); row.level = 'low'; }
        }
      }
      // 3. the amount alone
      if (row.status !== 'match') {
        var same = ix.open.filter(function (inv) { return !inv.disputed && Math.abs(E.openAt(inv, today) - x.amount) < EPS; });
        if (same.length === 1) { row.status = 'match'; row.how = 'amount'; row.level = 'low'; row.customerId = same[0].customerId; row.invoiceIds = [same[0].id]; row.notes.push({ code: 'amountOnly' }); }
      }
      if (row.status === 'match') {
        var al = allocFor(ix, row.customerId, x.amount, row.invoiceIds, today);
        row.parts = al.parts; row.rest = al.rest;
        if (al.rest > 0) row.notes.push({ code: 'rest', amount: al.rest });
        row.selected = row.level === 'high' || row.level === 'medium';
        if (!row.parts.length) row.selected = false;
      }
    });
    return rows;
  }
  /** re-allocate one row to another customer (the review screen's "Customer" choice) */
  function reassign(row, custId, db, today) {
    var ix = matchIndex(db, today), x = row.entry;
    row.customerId = custId || null; row.notes = [];
    if (!custId) { row.status = 'none'; row.parts = []; row.rest = 0; row.selected = false; row.how = ''; row.level = ''; return row; }
    var keep = row.invoiceIds.filter(function (id) { return (ix.openBy[custId] || []).some(function (i) { return i.id === id; }); });
    var al = allocFor(ix, custId, x.amount, keep.length ? keep : exactFit(ix, custId, x.amount, today) || [], today);
    row.status = 'match'; row.how = 'manual'; row.level = 'high'; row.parts = al.parts; row.rest = al.rest; row.selected = al.parts.length > 0;
    if (al.rest > 0) row.notes.push({ code: 'rest', amount: al.rest });
    return row;
  }

  // ── Croatia: monthly report of payments received on e-invoices ───────────
  /* Fiskalizacija 2.0, "eIzvještavanje o naplati": from 1 January 2026 the issuer of a domestic B2B eRačun reports
   * each payment received on it to the Tax Administration (Porezna uprava) by the 20th of the following month (first
   * deadline 20 February 2026 for January), per invoice: the e-invoice number, its issue date, the issuer's OIB, the
   * amount and the way it was paid, and the payment date. The report itself goes in through the Tax Administration's
   * web service, an information intermediary or the FiskAplikacija; this CSV is the list to submit or hand over.
   * Sources: Zakon o fiskalizaciji (Narodne novine 89/2025), in force 1 September 2025, applied from 1 January 2026;
   * Porezna uprava, Fiskalizacija 2.0 pages (https://porezna-uprava.gov.hr) and the eIzvještavanje summaries checked
   * 15 October 2026. SIMON MUST CONFIRM the exact columns, the payment-method codes and the file format against the
   * Tax Administration's technical specification (or the intermediary's import format) before a customer relies on it:
   * the published summaries name the data, not a CSV layout. Payment method "T" (transakcijski račun) is assumed for
   * bank transfers. */
  var HR_PAY_METHODS = { T: 'Transakcijski račun', G: 'Gotovina', K: 'Kartica', O: 'Ostalo' };
  /** payments received in `month` ('YYYY-MM') on invoices issued from 1 January 2026 to customers in Croatia */
  function hrPaymentReport(db, month, opts) {
    opts = opts || {};
    var from = month + '-01', to = E.endOfMonth(from), since = opts.since || '2026-01-01', co = db.company || {};
    var issuerOib = String(co.vatId || '').replace(/^HR/i, '').replace(/\s+/g, ''), rows = [], cust = {};
    (db.customers || []).forEach(function (c) { cust[c.id] = c; });
    (db.invoices || []).forEach(function (inv) {
      var c = cust[inv.customerId]; if (!c || c.country !== 'HR' || inv.issueDate < since) return;
      var byDay = {};
      (inv.payments || []).forEach(function (p) { if (p.date >= from && p.date <= to && +p.amount > 0) byDay[p.date] = E.round2((byDay[p.date] || 0) + +p.amount); });
      Object.keys(byDay).sort().forEach(function (d) {
        rows.push({ no: inv.no, issueDate: inv.issueDate, issuerOib: issuerOib, buyerOib: String(c.vatId || '').replace(/^HR/i, ''), buyer: c.name, payDate: d, amount: byDay[d], method: 'T', invoiceAmount: E.round2(+inv.amount || 0) });
      });
    });
    rows.sort(function (a, b) { return a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : a.no < b.no ? -1 : 1; });
    var deadline = E.addMonths(from, 1).slice(0, 8) + '20';
    return { month: month, from: from, to: to, deadline: deadline, rows: rows, total: E.round2(E.sum(rows, function (r) { return r.amount; })), issuerOib: issuerOib, issuerOk: E.hrOibValid(issuerOib) };
  }
  function dmy(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4); }
  function hrPaymentCsv(rep) {
    var head = ['Broj eRačuna', 'Datum izdavanja', 'OIB izdavatelja', 'OIB primatelja', 'Naziv primatelja', 'Datum naplate', 'Naplaćeni iznos', 'Način plaćanja', 'Valuta', 'Iznos računa'];
    return E.toCsv([head].concat(rep.rows.map(function (r) {
      return [r.no, dmy(r.issueDate), r.issuerOib, r.buyerOib, r.buyer, dmy(r.payDate), E.num2(r.amount), r.method, 'EUR', E.num2(r.invoiceAmount)];
    })));
  }

  return {
    parseXml: parseXml, parseCamt053: parseCamt053, BANK_FIELDS: BANK_FIELDS, parseBankCsv: parseBankCsv, entryId: entryId,
    refKeys: refKeys, refsInText: refsInText, nameTokens: nameTokens, nameScore: nameScore,
    matchIndex: matchIndex, allocFor: allocFor, exactFit: exactFit, matchEntries: matchEntries, reassign: reassign,
    HR_PAY_METHODS: HR_PAY_METHODS, hrPaymentReport: hrPaymentReport, hrPaymentCsv: hrPaymentCsv
  };
});
