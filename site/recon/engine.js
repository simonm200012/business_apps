/* Payment reconciliation engine (Business Apps): pure functions, no DOM. UMD, so it also loads in Node
 * (tools/tests/recon-engine.test.js). All money is INTEGER CENTS.
 *
 *   - matching rules: defaults, normalisation, the suggestion score (the defaults give exactly the scores the app
 *     always used: 40 base + 35 same e-mail + 15 same name + up to 10 for paying quickly);
 *   - bank statements: ISO 20022 camt.053 (BkToCstmrStmt, versions .001.02 to .001.13) → statement + entries;
 *   - provider reports: CSV parsing (";" "," or tab, quoted cells), number and date parsing in Slovenian and
 *     English styles, column-mapping guesses and the import of mapped rows as provider transactions;
 *   - journal for the accountant: balanced double-entry lines (one document per day and kind), CSV columns below;
 *   - month close: a fingerprint of a month's decisions and the list of what changed since the close.
 *
 * Journal CSV columns (UTF-8 with BOM, ";" separated, decimal comma, dates DD.MM.YYYY):
 *   Datum · Dokument · Konto · Partner · Opis · Debet · Kredit · Sklic · Vrsta
 *   Datum: booking date (bank date for payouts, payment date for clearing lines). Dokument: temeljnica number,
 *   e.g. "RC-2026-09-0001" (all lines of one document balance). Konto: account code from the settings (defaults
 *   follow the Slovenian chart of accounts, kontni okvir SRS: 110 bank, 109 money in transit = provider clearing,
 *   120/121 customers in Slovenia/abroad, 415 payment-service and bank charges, 230 advances received, 489 other
 *   expenses, 789 other income — Simon / the accountant must confirm them). Partner: provider or customer name
 *   (Minimax wants its own partner code here: map it in the template). Debet / Kredit: one of the two is filled.
 *   Minimax: Nastavitve → Uvozi podatkov → Uvoz iz Excela → Knjižbe makes the template; copy these columns into it,
 *   one file per type of temeljnica, date DD.MM.YYYY, konto as in the chart
 *   (https://si-minimax.knowledgeowl.com/help/pdfexport/id/5cb5dd1aad121c8075593cec). Pantheon: Knjigovodstvo →
 *   Temeljnice → uvoz from Excel takes the same columns (not verified against a live Pantheon: check once). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReconEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── matching rules ───────────────────────────────────────────────────────
  var WINDOW = { monri: [0, 3], adyen: [0, 3], paypal: [0, 3], flik: [0, 3], valu: [0, 3], klarna: [0, 10], cod: [1, 14], bank: [0, 21] };
  var RULES_DEFAULT = {
    base: 40,          // same amount (or within the amount tolerance)
    email: 35,         // same e-mail
    name: 15,          // same payer name (word order and accents ignored)
    speed: 10,         // bonus for paying quickly: speed − days after the order (never below 0)
    minScore: 50,      // suggestions below this score are not shown (40 + a customer match is the old minimum)
    needCustomer: true,// a suggestion needs the same e-mail or the same name
    amountTol: 0,      // cents a suggested payment may differ from the order (0 = exact)
    roundTol: 5,       // a difference up to this many cents is classified as "rounding"
    acceptMin: 90,     // default threshold of "Accept all with score ≥ N"
    windows: WINDOW    // days after the order date a payment may arrive, per provider [from, to]
  };
  function clampInt(v, lo, hi, def) { v = Math.round(+v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; }
  function normRules(r) {
    r = r && typeof r === 'object' ? r : {};
    var o = {
      base: clampInt(r.base, 0, 100, RULES_DEFAULT.base), email: clampInt(r.email, 0, 100, RULES_DEFAULT.email), name: clampInt(r.name, 0, 100, RULES_DEFAULT.name),
      speed: clampInt(r.speed, 0, 30, RULES_DEFAULT.speed), minScore: clampInt(r.minScore, 0, 100, RULES_DEFAULT.minScore),
      needCustomer: r.needCustomer == null ? RULES_DEFAULT.needCustomer : !!r.needCustomer,
      amountTol: clampInt(r.amountTol, 0, 10000, RULES_DEFAULT.amountTol), roundTol: clampInt(r.roundTol, 0, 1000, RULES_DEFAULT.roundTol),
      acceptMin: clampInt(r.acceptMin, 0, 100, RULES_DEFAULT.acceptMin), windows: {}
    };
    Object.keys(WINDOW).forEach(function (p) {
      var w = r.windows && Array.isArray(r.windows[p]) ? r.windows[p] : WINDOW[p];
      var a = clampInt(w[0], -30, 90, WINDOW[p][0]), b = clampInt(w[1], -30, 120, WINDOW[p][1]);
      o.windows[p] = a <= b ? [a, b] : [b, a];
    });
    return o;
  }
  function isDefaultRules(r) { return JSON.stringify(normRules(r)) === JSON.stringify(normRules(null)); }
  function inWindow(rules, provider, days) { var w = rules.windows[provider] || [0, 3]; return days >= w[0] && days <= w[1]; }
  /** score of a payment → order suggestion: { score, ok } (ok = shown as a suggestion) */
  function scoreOf(rules, f) {
    if (rules.needCustomer && !f.email && !f.name) return { score: 0, ok: false };
    var diff = Math.abs(f.amountDiff || 0);
    if (diff > rules.amountTol) return { score: 0, ok: false };
    var s = rules.base + (f.email ? rules.email : 0) + (f.name ? rules.name : 0) + Math.max(0, rules.speed - Math.max(0, f.days || 0));
    if (diff) s -= Math.min(10, Math.ceil(diff / 100)); // a small penalty per started euro of difference
    s = Math.max(0, Math.min(100, s));
    return { score: s, ok: s >= rules.minScore };
  }

  // ── small parsing helpers ────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isYmd(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.getUTCFullYear() === +s.slice(0, 4) && d.getUTCMonth() + 1 === +s.slice(5, 7) && d.getUTCDate() === +s.slice(8, 10);
  }
  /** '15.10.2026', '15. 10. 2026', '2026-10-15', '2026-10-15T08:00:00+02:00', '15/10/2026', '20261015' → '2026-10-15' (or '') */
  function parseDate(v) {
    var s = String(v == null ? '' : v).trim(), m, out = '';
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) out = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    else if ((m = /^(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{4})\.?(?:\s.*)?$/.exec(s))) out = m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) out = m[1] + '-' + m[2] + '-' + m[3];
    return isYmd(out) ? out : '';
  }
  /** amounts as text → integer cents, or null: '1.234,50' '1234,5' '-12.30' '1,234.50' '(12,00)' '12,00 €' '−5,00' */
  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
    var s = String(v == null ? '' : v).trim().replace(/[−–]/g, '-').replace(/[€$£]|EUR|CHF|GBP|USD/gi, '').replace(/[\s ']/g, '');
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/^[-+]/.test(s)) { neg = neg || s[0] === '-'; s = s.slice(1); }
    if (!/^[\d.,]+$/.test(s)) return null;
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc >= 0) s = /^[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'); // 1,234 = thousands; 0,125 / 12,5 = decimals
    else if (ld >= 0 && s.indexOf('.') !== ld) s = s.replace(/\./g, ''); // 1.234.567 thousands
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var c = Math.round(parseFloat(s) * 100);
    return neg ? -c : c;
  }
  function detectDelim(text) {
    var line = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '';
    var c = { ';': 0, ',': 0, '\t': 0 }, q = false, best = ';';
    for (var i = 0; i < line.length; i++) { var ch = line[i]; if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
    Object.keys(c).forEach(function (k) { if (c[k] > c[best]) best = k; });
    return best;
  }
  function parseCsv(text, delim) {
    text = String(text || '');
    delim = delim || detectDelim(text);
    var rows = [], row = [], f = '', q = false, i = text.charCodeAt(0) === 0xFEFF ? 1 : 0, n = text.length;
    for (; i < n; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"' && f === '') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return x.trim(); }); }).filter(function (r) { return r.some(function (x) { return x !== ''; }); });
  }
  function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

  // ── a minimal XML reader (enough for camt.053: elements, attributes, text, entities, CDATA) ─────────
  function xmlDecode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }
  function parseXml(text) {
    var rootN = { name: '#root', attrs: {}, kids: [], text: '' }, stack = [rootN], re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<\s*([^\s\/>]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g, m;
    while ((m = re.exec(text))) {
      var top = stack[stack.length - 1];
      if (m[1] != null) top.text += m[1];
      else if (m[2]) { var nm = m[2].replace(/^[^:]+:/, ''); for (var i = stack.length - 1; i > 0; i--) if (stack[i].name === nm) { stack.length = i; break; } }
      else if (m[3]) {
        var node = { name: m[3].replace(/^[^:]+:/, ''), attrs: {}, kids: [], text: '' }, am, ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        while ((am = ar.exec(m[4] || ''))) node.attrs[am[1].replace(/^[^:]+:/, '')] = xmlDecode(am[3] != null ? am[3] : am[4]);
        top.kids.push(node);
        if (!m[5]) stack.push(node);
      } else if (m[6] != null) top.text += xmlDecode(m[6]);
    }
    return rootN;
  }
  function kid(n, name) { if (!n) return null; for (var i = 0; i < n.kids.length; i++) if (n.kids[i].name === name) return n.kids[i]; return null; }
  function kids(n, name) { return n ? n.kids.filter(function (k) { return k.name === name; }) : []; }
  function at(n, path) { var p = path.split('/'); for (var i = 0; i < p.length && n; i++) n = kid(n, p[i]); return n; }
  function txt(n, path) { var x = path ? at(n, path) : n; return x ? x.text.trim() : ''; }
  function all(n, name, out) { out = out || []; if (!n) return out; n.kids.forEach(function (k) { if (k.name === name) out.push(k); all(k, name, out); }); return out; }
  function partyName(p) { return txt(p, 'Nm') || txt(p, 'Pty/Nm'); }
  function dateOf(n) { return n ? parseDate(txt(n, 'Dt') || txt(n, 'DtTm')) : ''; }

  /** camt.053 text → { ok, error, statements: [{ id, iban, currency, from, to, opening, closing, entries: [...] }] }
   *  entry: { key, date, valueDate, amount (signed cents, credit +), currency, status, counterparty, iban, text,
   *           ref (structured creditor reference, e.g. SI00 …), e2e, acctRef, bankTxCode } */
  function parseCamt053(text) {
    var s = String(text || '');
    if (!/BkToCstmrStmt/.test(s)) return { ok: false, error: 'This is not a camt.053 bank statement (no BkToCstmrStmt element).', statements: [] };
    var doc;
    try { doc = parseXml(s); } catch (e) { return { ok: false, error: 'The XML could not be read.', statements: [] }; }
    var stmts = all(doc, 'Stmt').map(function (st) {
      var iban = (txt(st, 'Acct/Id/IBAN') || txt(st, 'Acct/Id/Othr/Id')).replace(/\s+/g, ''), cur = txt(st, 'Acct/Ccy') || 'EUR';
      var bal = {};
      kids(st, 'Bal').forEach(function (b) {
        var code = txt(b, 'Tp/CdOrPrtry/Cd') || txt(b, 'Tp/CdOrPrtry/Prtry'), amt = parseAmount(txt(b, 'Amt'));
        if (amt == null) return;
        if (txt(b, 'CdtDbtInd') === 'DBIT') amt = -amt;
        if (!(code in bal)) bal[code] = { amount: amt, date: dateOf(kid(b, 'Dt')) };
      });
      var entries = kids(st, 'Ntry').map(function (e, i) {
        var amt = parseAmount(txt(e, 'Amt')), dbit = txt(e, 'CdtDbtInd') === 'DBIT';
        if (amt == null) return null;
        var tx = all(e, 'TxDtls')[0] || null, rp = tx ? kid(tx, 'RltdPties') : null;
        var cp = dbit ? (kid(rp, 'Cdtr') || kid(rp, 'Pty')) : (kid(rp, 'Dbtr') || kid(rp, 'Pty'));
        var cpAcct = dbit ? kid(rp, 'CdtrAcct') : kid(rp, 'DbtrAcct');
        var ustrd = tx ? all(tx, 'Ustrd').map(function (u) { return u.text.trim(); }).filter(Boolean).join(' ') : '';
        var ref = tx ? (txt(tx, 'RmtInf/Strd/CdtrRefInf/Ref') || '') : '';
        var info = txt(e, 'AddtlNtryInf'), e2e = tx ? txt(tx, 'Refs/EndToEndId') : '';
        if (e2e === 'NOTPROVIDED') e2e = '';
        var o = {
          date: dateOf(kid(e, 'BookgDt')) || dateOf(kid(e, 'ValDt')), valueDate: dateOf(kid(e, 'ValDt')),
          amount: dbit ? -amt : amt, currency: (kid(e, 'Amt') && kid(e, 'Amt').attrs.Ccy) || cur,
          status: txt(e, 'Sts/Cd') || txt(e, 'Sts') || 'BOOK',
          counterparty: cp ? partyName(cp) : '', iban: cpAcct ? (txt(cpAcct, 'Id/IBAN') || txt(cpAcct, 'Id/Othr/Id')) : '',
          text: ustrd || info || '', ref: ref, e2e: e2e, acctRef: txt(e, 'AcctSvcrRef') || (tx ? txt(tx, 'Refs/AcctSvcrRef') : ''),
          bankTxCode: txt(e, 'BkTxCd/Domn/Cd') ? txt(e, 'BkTxCd/Domn/Cd') + '/' + txt(e, 'BkTxCd/Domn/Fmly/Cd') + '/' + txt(e, 'BkTxCd/Domn/Fmly/SubFmlyCd') : txt(e, 'BkTxCd/Prtry/Cd')
        };
        o.key = entryKey(iban, o, i);
        return o;
      }).filter(function (x) { return x && x.date; });
      var op = bal.OPBD || bal.PRCD || null, cl = bal.CLBD || bal.CLAV || null;
      return { id: txt(st, 'Id') || txt(st, 'ElctrncSeqNb'), iban: iban.replace(/\s+/g, ''), currency: cur, from: parseDate(txt(st, 'FrToDt/FrDtTm')), to: parseDate(txt(st, 'FrToDt/ToDtTm')),
        opening: op ? op.amount : null, closing: cl ? cl.amount : null, entries: entries };
    });
    if (!stmts.length) return { ok: false, error: 'The file has no statement (Stmt) in it.', statements: [] };
    return { ok: true, error: '', statements: stmts };
  }
  /** a duplicate-safe key: the bank's own reference when there is one */
  function entryKey(iban, e, i) {
    if (e.acctRef) return 'camt:' + (iban || '') + ':' + e.acctRef;
    return 'camt:' + (iban || '') + ':' + e.date + ':' + e.amount + ':' + fold(e.counterparty) + ':' + fold(e.ref || e.text).slice(0, 40) + ':' + (e.e2e || i);
  }
  /** does opening + entries = closing? (null when the statement carries no balances) */
  function camtTies(st) {
    if (st.opening == null || st.closing == null) return null;
    var s = st.opening; st.entries.forEach(function (e) { if (e.status !== 'PDNG') s += e.amount; });
    return s === st.closing;
  }

  // ── provider CSV import (column mapping) ─────────────────────────────────
  var PROVIDER_FIELDS = [
    { key: 'date', label: 'Date', req: true, re: /^(date|datum|created|created ?(at|date)|transaction ?date|booking ?date|datum transakcije|datum placila|creation ?date|value ?date)$/ },
    { key: 'gross', label: 'Amount (gross)', req: true, re: /^(gross|amount|bruto|znesek|iznos|gross ?amount|amount ?gross|value|transaction ?amount|captured ?amount)$/ },
    { key: 'fee', label: 'Fee', re: /^(fee|fees|provizija|naknada|commission|fee ?amount|transaction ?fee|processing ?fee)$/ },
    { key: 'net', label: 'Net', re: /^(net|neto|net ?amount|payout ?amount)$/ },
    { key: 'currency', label: 'Currency', re: /^(currency|valuta|ccy|curr)$/ },
    { key: 'ref', label: 'Merchant reference / order no.', re: /^(merchant ?reference|reference|referenca|order|order ?(no|number|id)|narocilo|st ?narocila|invoice|sklic|poziv na broj|description|opis|merchant ?ref)$/ },
    { key: 'email', label: 'Customer e-mail', re: /e ?mail|shopper ?email|payer ?email|from ?email/ },
    { key: 'payer', label: 'Customer name', re: /^(name|payer|customer|kupec|kupac|shopper ?name|card ?holder|cardholder|from ?name|ime)$/ },
    { key: 'type', label: 'Type (sale / refund / chargeback)', re: /^(type|tip|vrsta|transaction ?type|record ?type|event)$/ },
    { key: 'id', label: 'Transaction id', re: /^(id|transaction ?id|psp ?reference|txn ?id|transakcija|id transakcije|reference ?id)$/ },
    { key: 'batch', label: 'Payout / settlement batch', re: /batch|payout|settlement|izplacilo|isplata/ }
  ];
  function guessMapping(headers, fields) {
    fields = fields || PROVIDER_FIELDS;
    var map = {}, used = {};
    fields.forEach(function (f) {
      for (var i = 0; i < headers.length; i++) {
        if (used[i]) continue;
        if (f.re.test(fold(headers[i]))) { map[f.key] = String(i); used[i] = 1; return; }
      }
      map[f.key] = '';
    });
    return map;
  }
  function typeOf(raw, gross) {
    var t = fold(raw);
    if (/charge ?back|dispute|reklamacija|spor/.test(t)) return 'chargeback';
    if (/refund|return|vracilo|povrat|storno|credit/.test(t)) return 'refund';
    if (t && /sale|capture|payment|placilo|placanje|settled|authori[sz]ed|charge|nakup/.test(t)) return 'capture';
    return gross < 0 ? 'refund' : 'capture';
  }
  /** rows (arrays) + map {field: column index as string} → { txns, errors, skipped }
   *  opts: { provider, account, country, existing: {key: 1}, feeSign: 'auto'|'positive' } */
  function buildProviderImport(rows, map, opts) {
    opts = opts || {};
    var out = [], errors = [], skipped = 0, seen = Object.assign({}, opts.existing || {});
    rows.forEach(function (r, i) {
      function g(k) { var ix = map[k]; return ix === '' || ix == null ? '' : (r[+ix] == null ? '' : String(r[+ix]).trim()); }
      var line = i + 1, date = parseDate(g('date')), gross = parseAmount(g('gross'));
      if (!date) { errors.push({ line: line, msg: 'no valid date ("' + g('date') + '")' }); return; }
      if (gross == null) { errors.push({ line: line, msg: 'no valid amount ("' + g('gross') + '")' }); return; }
      var fee = parseAmount(g('fee')), net = parseAmount(g('net'));
      if (fee == null && net != null) fee = gross - net;
      fee = Math.abs(fee || 0);
      var cur = (g('currency') || 'EUR').toUpperCase();
      if (cur !== 'EUR') { errors.push({ line: line, msg: 'currency ' + cur + ' (only EUR rows are imported)' }); return; }
      var type = typeOf(g('type'), gross);
      if (type !== 'capture' && gross > 0) gross = -gross;
      var id = g('id'), key = 'csv:' + (opts.provider || '') + ':' + (id || (date + ':' + gross + ':' + fold(g('ref')) + ':' + fold(g('email'))));
      if (seen[key]) { skipped++; return; }
      seen[key] = 1;
      out.push({ key: key, provider: opts.provider || 'adyen', account: opts.account || opts.provider || 'adyen', type: type, date: date, time: '12:00', gross: gross, fee: fee,
        ref: g('ref'), email: g('email').toLowerCase(), payer: g('payer'), extId: id, batch: g('batch'), country: opts.country || 'SI' });
    });
    return { txns: out, errors: errors, skipped: skipped };
  }

  // ── journal (double entry) ───────────────────────────────────────────────
  var ACCOUNTS_DEFAULT = { bank: '110', clearing: '109', customers: '120', customersAbroad: '121', fees: '415', advances: '230', otherExpense: '489', otherIncome: '789' };
  function normAccounts(a) { var o = {}; a = a || {}; Object.keys(ACCOUNTS_DEFAULT).forEach(function (k) { var v = String(a[k] == null ? '' : a[k]).trim(); o[k] = /^[0-9A-Za-z.\-]{1,12}$/.test(v) ? v : ACCOUNTS_DEFAULT[k]; }); return o; }
  /** items → documents. Each item: { kind, date, amount (cents), fee, provider (name), customerAbroad, partner, ref, text }
   *  kinds: payout (bank D net, fees D fee, clearing C gross), capture (clearing D, customers C), refund / chargeback
   *  (customers D, clearing C), transfer (customer paid to the bank: bank D, customers C), unmatched (clearing D,
   *  advances C), unmatched_bank (bank D, advances C), writeoff_loss (other expenses D, customers C), writeoff_gain (customers D, other income C).
   *  One document per (date, kind, provider); returns { docs: [{ no, date, kind, lines: [...] , debit, credit }] } */
  function journal(items, accounts, opts) {
    var A = normAccounts(accounts), prefix = (opts && opts.prefix) || 'RC', groups = {}, order = [];
    items.forEach(function (it) {
      if (!it || !it.amount && !it.fee) return;
      var k = it.date + '|' + it.kind + '|' + (it.provider || '');
      if (!groups[k]) { groups[k] = { date: it.date, kind: it.kind, provider: it.provider || '', items: [] }; order.push(k); }
      groups[k].items.push(it);
    });
    order.sort();
    var seq = 0, docs = [];
    order.forEach(function (k) {
      var g = groups[k], lines = [], no = prefix + '-' + g.date.slice(0, 4) + '-' + g.date.slice(5, 7) + '-' + String(++seq).padStart(4, '0');
      function add(konto, partner, opis, cents, ref) {
        if (!cents) return;
        lines.push({ konto: konto, partner: partner || '', opis: opis, debit: cents > 0 ? cents : 0, credit: cents < 0 ? -cents : 0, ref: ref || '' });
      }
      var KIND = { payout: 'Izplačilo ponudnika', capture: 'Plačila kupcev prek ponudnika', refund: 'Vračila kupcem', chargeback: 'Reklamacije (chargeback)', transfer: 'Nakazila kupcev na TRR', unmatched: 'Neprepoznana plačila', unmatched_bank: 'Neprepoznana nakazila na TRR', writeoff_loss: 'Odpis razlike (manj plačano)', writeoff_gain: 'Odpis razlike (preveč plačano)' };
      var lab = KIND[g.kind] || g.kind;
      if (g.kind === 'payout') {
        g.items.forEach(function (it) {
          var gross = it.amount + (it.fee || 0);
          add(A.bank, it.provider, lab + ' ' + (it.ref || ''), it.amount, it.ref);
          add(A.fees, it.provider, 'Provizija ' + (it.provider || '') + ' ' + (it.ref || ''), it.fee || 0, it.ref);
          add(A.clearing, it.provider, lab + ' ' + (it.ref || ''), -gross, it.ref);
        });
      } else {
        var dom = 0, abroad = 0;
        g.items.forEach(function (it) { if (it.customerAbroad) abroad += it.amount; else dom += it.amount; });
        var tot = dom + abroad, desc = lab + (g.provider ? ' · ' + g.provider : '') + ' · ' + g.items.length + ' ' + postavk(g.items.length);
        if (g.kind === 'capture') { add(A.clearing, g.provider, desc, tot); add(A.customers, '', desc, -dom); add(A.customersAbroad, '', desc, -abroad); }
        else if (g.kind === 'refund' || g.kind === 'chargeback') { add(A.customers, '', desc, dom); add(A.customersAbroad, '', desc, abroad); add(A.clearing, g.provider, desc, -tot); }
        else if (g.kind === 'transfer') { add(A.bank, '', desc, tot); add(A.customers, '', desc, -dom); add(A.customersAbroad, '', desc, -abroad); }
        else if (g.kind === 'unmatched') { add(A.clearing, g.provider, desc, tot); add(A.advances, g.provider, desc, -tot); }
        else if (g.kind === 'unmatched_bank') { add(A.bank, '', desc, tot); add(A.advances, g.provider, desc, -tot); }
        else if (g.kind === 'writeoff_loss') { add(A.otherExpense, '', desc, tot); add(A.customers, '', desc, -dom); add(A.customersAbroad, '', desc, -abroad); }
        else if (g.kind === 'writeoff_gain') { add(A.customers, '', desc, dom); add(A.customersAbroad, '', desc, abroad); add(A.otherIncome, '', desc, -tot); }
      }
      // negative amounts (a payout below zero, a negative transfer) land on the other side: normalise
      lines.forEach(function (l) { if (l.debit < 0) { l.credit = -l.debit; l.debit = 0; } if (l.credit < 0) { l.debit = -l.credit; l.credit = 0; } });
      var d = 0, c = 0; lines.forEach(function (l) { d += l.debit; c += l.credit; });
      if (lines.length) docs.push({ no: no, date: g.date, kind: g.kind, lines: lines, debit: d, credit: c });
    });
    return { docs: docs, accounts: A };
  }
  function postavk(n) { var r = n % 100; return r === 1 ? 'postavka' : r === 2 ? 'postavki' : r === 3 || r === 4 ? 'postavke' : 'postavk'; } // Slovenian dual and plural
  var JOURNAL_HEADER = ['Datum', 'Dokument', 'Konto', 'Partner', 'Opis', 'Debet', 'Kredit', 'Sklic', 'Vrsta'];
  function dmy(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }
  function c2(c) { return c ? (c / 100).toFixed(2) : ''; }
  function journalRows(J) {
    var rows = [];
    J.docs.forEach(function (d) { d.lines.forEach(function (l) { rows.push([dmy(d.date), d.no, l.konto, l.partner, l.opis.trim(), c2(l.debit), c2(l.credit), l.ref, d.kind]); }); });
    return rows;
  }

  // ── month close: fingerprint and changes ─────────────────────────────────
  /** state of every item of a month: { 'T123': 'L5|exact' (match key + confidence) or '' (unmatched), 'X:<exception id>': status } */
  function fingerprintDiff(before, after) {
    var out = [], keys = {};
    Object.keys(before || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(after || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (k) {
      var a = before && k in before ? before[k] : null, b = after && k in after ? after[k] : null;
      if (a !== b) out.push({ key: k, before: a, after: b });
    });
    return out;
  }
  function hashFp(fp) { // FNV-1a over the sorted entries: a short digest stored with a sign-off
    var h = 0x811c9dc5, s = Object.keys(fp || {}).sort().map(function (k) { return k + '=' + fp[k]; }).join('\n');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  return {
    WINDOW: WINDOW, RULES_DEFAULT: RULES_DEFAULT, normRules: normRules, isDefaultRules: isDefaultRules, inWindow: inWindow, scoreOf: scoreOf,
    parseDate: parseDate, parseAmount: parseAmount, detectDelim: detectDelim, parseCsv: parseCsv, fold: fold,
    parseXml: parseXml, parseCamt053: parseCamt053, camtTies: camtTies,
    PROVIDER_FIELDS: PROVIDER_FIELDS, guessMapping: guessMapping, typeOf: typeOf, buildProviderImport: buildProviderImport,
    ACCOUNTS_DEFAULT: ACCOUNTS_DEFAULT, normAccounts: normAccounts, journal: journal, JOURNAL_HEADER: JOURNAL_HEADER, journalRows: journalRows,
    fingerprintDiff: fingerprintDiff, hashFp: hashFp
  };
});
