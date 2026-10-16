/* Cash forecast importers (Business Apps): pure functions, no DOM. UMD, so they also load in Node.
 *  - open receivables / payables from a CSV or an Excel CSV (Minimax, Pantheon or any ERP): text decoding
 *    (UTF-8 or the Windows-1250 that Slovenian Excel writes), delimiter, the header row under any title rows,
 *    column mapping guessed from Slovenian, Croatian and English names, validation with row numbers;
 *  - bank statements: ISO 20022 camt.053 (and camt.052) XML, or a bank CSV with a balance column, for each account's
 *    balance on the statement date, plus the statement's payments that exactly match open invoices.
 * The column names below are the usual ones in Minimax "Odprte postavke" and Pantheon "Odprte postavke / Saldakonti"
 * exports and in Slovenian bank CSV exports; they are guesses for the mapping, and the user can always change them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var EPS = 0.005;
  function round2(x) { return Math.round(x * 100) / 100; }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.getUTCFullYear() === +s.slice(0, 4) && d.getUTCMonth() + 1 === +s.slice(5, 7) && d.getUTCDate() === +s.slice(8, 10);
  }

  // ── text ─────────────────────────────────────────────────────────────────
  /** bytes of a file → text. UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1250 (Slovenian Excel "CSV"). */
  function decodeBytes(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder('utf-16le').decode(u.subarray(2));
    if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder('utf-16be').decode(u.subarray(2));
    if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) u = u.subarray(3);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u); }
    catch (e) {
      try { return new TextDecoder('windows-1250').decode(u); }
      catch (e2) { return new TextDecoder('iso-8859-2').decode(u); }
    }
  }
  /** which encoding decodeBytes would use (shown in the preview) */
  function encodingOf(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if ((u[0] === 0xFF && u[1] === 0xFE) || (u[0] === 0xFE && u[1] === 0xFF)) return 'UTF-16';
    if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return 'UTF-8';
    try { new TextDecoder('utf-8', { fatal: true }).decode(u); return 'UTF-8'; } catch (e) { return 'Windows-1250'; }
  }

  // ── CSV ──────────────────────────────────────────────────────────────────
  /** CSV text → { delimiter, rows } (row i is line i + 1 of the sheet). Delimiter ; , or tab from the first lines (outside quotes); "sep=;" (Excel) is honoured. */
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var delim = null, m = /^sep=(.)\r?\n/i.exec(text);
    if (m) { delim = m[1]; text = text.slice(m[0].length); }
    if (!delim) {
      var counts = { ';': 0, ',': 0, '\t': 0 }, q = false, lines = 0;
      for (var j = 0; j < text.length && lines < 12; j++) {
        var c = text[j];
        if (c === '"') q = !q;
        else if (!q && c === '\n') lines++;
        else if (!q && counts[c] !== undefined) counts[c]++;
      }
      delim = counts['\t'] > counts[';'] && counts['\t'] > counts[','] ? '\t' : counts[','] > counts[';'] ? ',' : ';';
    }
    var rows = [], row = [], cell = '', inQ = false;
    for (var i = 0, n = text.length; i < n; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"' && cell.trim() === '') { inQ = true; cell = ''; }
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    // empty rows are kept (so "Row 6" is row 6 in Excel), except at the end
    while (rows.length && !rows[rows.length - 1].some(function (x) { return String(x).trim() !== ''; })) rows.pop();
    return { delimiter: delim, rows: rows };
  }
  /** 1.234,56 · 1234,56 · 1,234.56 · 1234.56 · 1.234 (thousands) · −12 · 12- · (12) · with € / EUR / spaces; NaN when not a number */
  function parseNumber(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/EUR|€/gi, '').replace(/[\s  ']/g, '');
    if (/^[−-]/.test(s)) { neg = !neg; s = s.slice(1); }
    else if (/^\+/.test(s)) s = s.slice(1);
    if (/[−-]$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (!/^[\d.,]+$/.test(s)) return NaN;
    var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      if ((s.match(/,/g) || []).length > 1) { if (!/^[1-9]\d{0,2}(,\d{3})+$/.test(s)) return NaN; s = s.replace(/,/g, ''); }
      else s = s.replace(',', '.');
    } else if (lastDot >= 0) {
      if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      else if ((s.match(/\./g) || []).length > 1) return NaN;
    }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    var v = Number(s);
    return isFinite(v) ? (neg ? -v : v) : NaN;
  }
  /** 13.10.2026 · 13. 10. 2026 · 13.10.2026. · 13.10.26 · 2026-10-13 · 13/10/2026 · with a time after it → '2026-10-13'; null otherwise */
  function parseDate(s) {
    s = String(s == null ? '' : s).trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
    if (isDate(s)) return s;
    var m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}|\d{2})\.?$/.exec(s) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s), d;
    if (m) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; d = y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); return isDate(d) ? d : null; }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) { d = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'); return isDate(d) ? d : null; }
    return null;
  }

  // ── open receivables and payables ────────────────────────────────────────
  // hints: exact names first; the score prefers an exact match, then "starts with", then "contains"
  var NO_HINTS = ['invoice number', 'invoice no', 'bill number', 'št. računa', 'št računa', 'številka računa', 'stevilka racuna', 'številka dokumenta', 'št. dokumenta', 'broj računa', 'broj racuna', 'broj dokumenta', 'dokument', 'document', 'račun', 'racun', 'številka', 'stevilka', 'number', 'invoice', 'bill', 'broj', 'no', 'št.'];
  var DUE_HINTS = ['due date', 'datum zapadlosti', 'dat. zapadlosti', 'zapadlost', 'dat. zap.', 'datum dospijeća', 'datum dospijeca', 'dospijeće', 'dospijece', 'valuta', 'rok plačila', 'rok placila', 'due'];
  var ISSUE_HINTS = ['issue date', 'invoice date', 'datum računa', 'datum racuna', 'datum dokumenta', 'dat. dokumenta', 'datum izdaje', 'datum izdavanja', 'datum knjiženja', 'issued', 'datum', 'date'];
  var OPEN_HINTS = ['open amount', 'odprti znesek', 'odprto', 'za plačilo', 'za placilo', 'neplačano', 'neplacano', 'saldo', 'otvoreno', 'preostalo', 'outstanding', 'open', 'balance'];
  var AMOUNT_HINTS = ['invoice amount', 'znesek računa', 'znesek racuna', 'znesek z ddv', 'vrednost z ddv', 'iznos računa', 'iznos s pdv', 'znesek', 'iznos', 'bruto', 'gross', 'amount', 'total', 'vrednost', 'vrijednost', 'debet', 'duguje'];
  var VAT_HINTS = ['id za ddv', 'davčna številka', 'davcna stevilka', 'ddv številka', 'vat id', 'vat number', 'oib', 'davčna', 'davcna', 'ddv', 'vat', 'pdv'];
  var FIELDS = {
    ar: [
      { id: 'no', label: 'Invoice number', required: true, hints: NO_HINTS },
      { id: 'party', label: 'Customer', required: true, hints: ['naziv kupca', 'naziv partnerja', 'naziv stranke', 'kupec', 'kupac', 'customer', 'partner', 'stranka', 'subjekt', 'naziv', 'client', 'name'] },
      { id: 'vatId', label: 'Customer VAT ID', hints: VAT_HINTS },
      { id: 'due', label: 'Due date', required: true, hints: DUE_HINTS },
      { id: 'issued', label: 'Issue date', hints: ISSUE_HINTS },
      { id: 'open', label: 'Open amount', hints: OPEN_HINTS },
      { id: 'amount', label: 'Invoice amount (gross)', hints: AMOUNT_HINTS }
    ],
    ap: [
      { id: 'no', label: 'Bill number', required: true, hints: NO_HINTS },
      { id: 'party', label: 'Supplier', required: true, hints: ['naziv dobavitelja', 'naziv partnerja', 'dobavitelj', 'dobavljač', 'dobavljac', 'supplier', 'vendor', 'partner', 'subjekt', 'naziv', 'name'] },
      { id: 'vatId', label: 'Supplier VAT ID', hints: VAT_HINTS },
      { id: 'due', label: 'Due date', required: true, hints: DUE_HINTS },
      { id: 'issued', label: 'Issue date', hints: ISSUE_HINTS },
      { id: 'open', label: 'Open amount', hints: OPEN_HINTS },
      { id: 'amount', label: 'Bill amount (gross)', hints: AMOUNT_HINTS.concat(['kredit', 'potražuje', 'potrazuje']) }
    ]
  };
  function normHead(h) { return String(h || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').replace(/[:*]+$/, '').trim(); }
  function score(h, hints) {
    var best = 0;
    hints.forEach(function (hint, k) {
      var sc = h === hint ? 100 - k : (h.indexOf(hint) === 0 ? 60 - k : (hint.length > 3 && h.indexOf(hint) > 0 ? 30 - k : 0));
      if (sc > best) best = sc;
    });
    return best;
  }
  /** column index for each field from the header names; -1 when not found. Best-scoring pairs are taken first. */
  function guessMapping(headers, fields) {
    var H = headers.map(normHead), pairs = [], map = {}, usedCol = {};
    fields.forEach(function (f, fi) { H.forEach(function (h, i) { if (h) { var s = score(h, f.hints); if (s > 0) pairs.push({ f: f.id, i: i, s: s, fi: fi }); } }); });
    pairs.sort(function (a, b) { return b.s - a.s || a.fi - b.fi || a.i - b.i; });
    fields.forEach(function (f) { map[f.id] = -1; });
    pairs.forEach(function (p) { if (map[p.f] < 0 && !usedCol[p.i]) { map[p.f] = p.i; usedCol[p.i] = 1; } });
    return map;
  }
  /** the header row: the one among the first 20 that maps the most required fields (exports often start with title rows) */
  function findHeaderRow(rows, fields) {
    var best = 0, bestScore = -1;
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      var m = guessMapping(rows[i], fields), sc = 0;
      fields.forEach(function (f) { if (m[f.id] >= 0) sc += f.required ? 10 : 1; });
      if (sc > bestScore) { best = i; bestScore = sc; }
    }
    return best;
  }
  var SUMMARY = /^(skupaj|skupno|vsota|seštevek|sestevek|ukupno|sveukupno|total|totals|sum|saldo)\b/i;
  /** Validate mapped rows of an open-items file. kind 'ar' | 'ap'. Returns { items, errors, warnings }:
   * items: { line, no, party, vatId, issued, due, amount (still open), gross }. Any error blocks the whole import. */
  function buildOpenItems(rows, mapping, opts) {
    opts = opts || {};
    var fields = FIELDS[opts.kind === 'ap' ? 'ap' : 'ar'], head = opts.headerRow || 0, today = opts.today;
    var items = [], errors = [], warnings = [], seen = {}, missingIssue = 0, noun = opts.kind === 'ap' ? 'bill' : 'invoice';
    fields.forEach(function (f) { if (f.required && !(mapping[f.id] >= 0)) errors.push('Choose the column for "' + f.label + '".'); });
    if (!(mapping.open >= 0) && !(mapping.amount >= 0)) errors.push('Choose the column for the open amount (or the invoice amount).');
    if (errors.length) return { items: items, errors: errors, warnings: warnings };
    function get(r, k) { return mapping[k] >= 0 ? String(r[mapping[k]] == null ? '' : r[mapping[k]]).trim() : ''; }
    var body = rows.slice(head + 1);
    body.forEach(function (r, i) {
      var line = head + i + 2, errs = [];
      var no = get(r, 'no'), party = get(r, 'party').replace(/\s+/g, ' ');
      var dueRaw = get(r, 'due'), due = parseDate(dueRaw), issRaw = get(r, 'issued'), iss = issRaw ? parseDate(issRaw) : null;
      var grossRaw = get(r, 'amount'), gross = grossRaw === '' ? NaN : parseNumber(grossRaw);
      var openRaw = get(r, 'open'), open = openRaw === '' ? gross : parseNumber(openRaw);
      // totals and sub-totals at the end of a report, and blank separator rows
      if (!no && (SUMMARY.test(party) || SUMMARY.test(String(r[0] || '').trim()) || (!party && !dueRaw))) {
        if (r.some(function (x) { return String(x).trim(); })) warnings.push('Row ' + line + ': a total line, skipped.');
        return;
      }
      if (!no) errs.push('the ' + noun + ' number is empty');
      if (!party) errs.push('the ' + (opts.kind === 'ap' ? 'supplier' : 'customer') + ' is empty');
      if (!due) errs.push(dueRaw ? 'due date "' + dueRaw + '" is not a date (use 31.10.2026 or 2026-10-31)' : 'the due date is empty');
      if (issRaw && !iss) errs.push('issue date "' + issRaw + '" is not a date');
      if (grossRaw !== '' && isNaN(gross)) errs.push('amount "' + grossRaw + '" is not a number');
      if (openRaw !== '' && isNaN(open)) errs.push('open amount "' + openRaw + '" is not a number');
      if (openRaw === '' && grossRaw === '') errs.push('the amount is empty');
      if (due && iss && iss > due) errs.push('the due date is before the issue date');
      var key = party.toLowerCase() + '|' + no;
      if (no && seen[key]) errs.push(noun + ' ' + no + ' of ' + party + ' appears twice in the file (rows ' + seen[key] + ' and ' + line + ')');
      if (no) seen[key] = seen[key] || line;
      if (errs.length) { errs.forEach(function (e) { errors.push('Row ' + line + ': ' + e + '.'); }); return; }
      if (gross > 0 && open > gross + EPS) { errors.push('Row ' + line + ': the open amount is larger than the ' + noun + ' amount.'); return; }
      if (open < -EPS) { warnings.push('Row ' + line + ': ' + no + ' has a negative open amount (a credit note or an advance), skipped.'); return; }
      if (open <= EPS) { warnings.push('Row ' + line + ': ' + no + ' is fully paid, skipped.'); return; }
      if (!iss) { iss = due; missingIssue++; }
      items.push({ line: line, no: no, party: party, vatId: get(r, 'vatId').replace(/\s+/g, '').toUpperCase(), issued: iss, due: due, amount: round2(open), gross: gross > 0 ? round2(gross) : round2(open) });
    });
    if (missingIssue) warnings.push(missingIssue + (missingIssue === 1 ? ' row has' : ' rows have') + ' no issue date: the due date is used.');
    if (!body.length) errors.push('The file has no rows under the header.');
    else if (!items.length && !errors.length) errors.push('No open ' + noun + 's in the file.');
    if (today) { var fut = items.filter(function (it) { return it.issued > today; }).length; if (fut) warnings.push(fut + ' ' + (fut === 1 ? noun + ' is' : noun + 's are') + ' dated in the future.'); }
    return { items: items, errors: errors, warnings: warnings };
  }
  /** company names compared without case, punctuation or the legal form (d.o.o., d.d., s.p., GmbH …) */
  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b(d\s*\.?\s*o\s*\.?\s*o|d\s*\.?\s*d|s\s*\.?\s*p|j\s*\.?\s*d\s*\.?\s*o\s*\.?\s*o|gmbh|ag|srl|s\.r\.l|kft|a\.s|b\.v|s\.a|ltd|llc|inc)\b\.?/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ── a tiny XML reader (enough for bank statements) ───────────────────────
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      if (e[0] === '#') { var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }
  /** XML text → { name, attrs, children, text } (names without namespace prefixes). Throws on badly nested tags. */
  function parseXml(text) {
    text = String(text || '').replace(/^﻿/, '');
    var rootEl = { name: '#root', attrs: {}, children: [], text: '' }, stack = [rootEl], i = 0, n = text.length;
    while (i < n) {
      var lt = text.indexOf('<', i);
      if (lt < 0) { stack[stack.length - 1].text += decodeEntities(text.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += decodeEntities(text.slice(i, lt));
      if (text.startsWith('<!--', lt)) { var ce = text.indexOf('-->', lt); if (ce < 0) throw new Error('Unclosed comment'); i = ce + 3; continue; }
      if (text.startsWith('<![CDATA[', lt)) { var cd = text.indexOf(']]>', lt); if (cd < 0) throw new Error('Unclosed CDATA'); stack[stack.length - 1].text += text.slice(lt + 9, cd); i = cd + 3; continue; }
      if (text[lt + 1] === '?' || text[lt + 1] === '!') { var pe = text.indexOf('>', lt); if (pe < 0) throw new Error('Unclosed declaration'); i = pe + 1; continue; }
      var gt = lt + 1, q = null;
      for (; gt < n; gt++) { var ch = text[gt]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
      if (gt >= n) throw new Error('Unclosed tag');
      var tag = text.slice(lt + 1, gt);
      i = gt + 1;
      if (tag[0] === '/') {
        var cname = tag.slice(1).trim().replace(/^.*:/, ''), top = stack.pop();
        if (!top || top.name !== cname || !stack.length) throw new Error('Badly nested tag </' + cname + '>');
        continue;
      }
      var self = /\/\s*$/.test(tag); if (self) tag = tag.replace(/\/\s*$/, '');
      var mm = /^([^\s]+)([\s\S]*)$/.exec(tag.trim()); if (!mm) throw new Error('Empty tag');
      var el = { name: mm[1].replace(/^.*:/, ''), attrs: {}, children: [], text: '' }, re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, am;
      while ((am = re.exec(mm[2]))) el.attrs[am[1].replace(/^.*:/, '')] = decodeEntities(am[3] != null ? am[3] : am[4]);
      stack[stack.length - 1].children.push(el);
      if (!self) stack.push(el);
    }
    if (stack.length !== 1) throw new Error('Unclosed tag <' + stack[stack.length - 1].name + '>');
    return rootEl;
  }
  function kids(el, name) { return el ? el.children.filter(function (c) { return c.name === name; }) : []; }
  function kid(el) { for (var i = 1; i < arguments.length; i++) { el = el ? kids(el, arguments[i])[0] : null; } return el || null; }
  function txt(el) { return el ? el.text.trim() : ''; }
  function all(el, name, out) { out = out || []; if (!el) return out; el.children.forEach(function (c) { if (c.name === name) out.push(c); all(c, name, out); }); return out; }

  // ── camt.053 / camt.052 ──────────────────────────────────────────────────
  // ISO 20022 "BankToCustomerStatement" (camt.053.001.02 … .08) and "BankToCustomerAccountReport" (camt.052), the
  // XML statements Slovenian and Croatian banks offer for download (SEPA, ZBS/HUB guidelines). Balance codes:
  // CLBD closing booked, ITBD interim booked, OPBD opening booked, PRCD previous closing, CLAV closing available.
  var BAL_PREF = ['CLBD', 'ITBD', 'CLAV', 'ITAV'];
  function signedAmt(el) {
    var raw = txt(kid(el, 'Amt')), ind = txt(kid(el, 'CdtDbtInd'));
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return NaN; // ISO 20022 amounts: digits and a decimal point only
    var a = Number(raw);
    return ind === 'DBIT' ? -a : a;
  }
  function dateOf(el) { var d = kid(el, 'Dt'); if (!d) return null; var s = txt(kid(d, 'Dt')) || txt(kid(d, 'DtTm')) || txt(d); return parseDate(s.slice(0, 10)); }
  /** camt XML → { statements: [{ iban, currency, owner, balance, date, balanceType, from, to, entries }], errors } */
  function parseCamt(text) {
    var doc;
    try { doc = parseXml(text); } catch (e) { return { statements: [], errors: ['This is not a readable XML file (' + e.message + ').'] }; }
    var top = all(doc, 'BkToCstmrStmt')[0] || all(doc, 'BkToCstmrAcctRpt')[0];
    if (!top) return { statements: [], errors: ['This XML is not a camt.053 or camt.052 bank statement (no BkToCstmrStmt).'] };
    var out = [], errors = [];
    kids(top, 'Stmt').concat(kids(top, 'Rpt')).forEach(function (st, si) {
      var acct = kid(st, 'Acct'), iban = txt(kid(acct, 'Id', 'IBAN')) || txt(kid(acct, 'Id', 'Othr', 'Id'));
      var ccy = txt(kid(acct, 'Ccy')), owner = txt(kid(acct, 'Ownr', 'Nm')) || txt(kid(acct, 'Nm'));
      var bals = kids(st, 'Bal').map(function (b) {
        var code = txt(kid(b, 'Tp', 'CdOrPrtry', 'Cd')) || txt(kid(b, 'Tp', 'CdOrPrtry', 'Prtry'));
        var amtEl = kid(b, 'Amt');
        return { code: code, amount: signedAmt(b), date: dateOf(b), ccy: amtEl && amtEl.attrs.Ccy || ccy };
      }).filter(function (b) { return isFinite(b.amount); });
      var entries = kids(st, 'Ntry').map(function (e) {
        var sts = txt(kid(e, 'Sts', 'Cd')) || txt(kid(e, 'Sts'));
        var bits = [txt(kid(e, 'AddtlNtryInf'))], party = '';
        all(e, 'TxDtls').forEach(function (tx) {
          kids(kid(tx, 'RmtInf'), 'Ustrd').forEach(function (u) { bits.push(txt(u)); });
          all(kid(tx, 'RmtInf'), 'Ref').forEach(function (r) { bits.push(txt(r)); });
          all(kid(tx, 'Refs'), 'EndToEndId').forEach(function (r) { if (txt(r) !== 'NOTPROVIDED') bits.push(txt(r)); });
          var cdt = signedAmt(e) >= 0, rp = kid(tx, 'RltdPties');
          var p = kid(rp, cdt ? 'Dbtr' : 'Cdtr'); party = party || txt(kid(p, 'Nm')) || txt(kid(p, 'Pty', 'Nm'));
        });
        var bk = kid(e, 'BookgDt'), vd = kid(e, 'ValDt');
        var date = bk ? parseDate((txt(kid(bk, 'Dt')) || txt(kid(bk, 'DtTm'))).slice(0, 10)) : vd ? parseDate((txt(kid(vd, 'Dt')) || txt(kid(vd, 'DtTm'))).slice(0, 10)) : null;
        return { date: date, amount: round2(signedAmt(e)), booked: !sts || sts === 'BOOK', party: party, text: bits.filter(Boolean).join(' · ').slice(0, 400) };
      }).filter(function (e) { return isFinite(e.amount); });
      var pick = null;
      BAL_PREF.some(function (code) { var c = bals.filter(function (b) { return b.code === code && b.date; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0]; if (c) { pick = c; return true; } return false; });
      if (!pick) {
        var op = bals.filter(function (b) { return (b.code === 'OPBD' || b.code === 'PRCD') && b.date; })[0];
        if (op) {
          var booked = entries.filter(function (x) { return x.booked; }), last = booked.reduce(function (m, x) { return x.date && x.date > m ? x.date : m; }, op.date);
          pick = { code: op.code + '+entries', amount: round2(op.amount + booked.reduce(function (s, x) { return s + x.amount; }, 0)), date: last, ccy: op.ccy };
        }
      }
      var fr = kid(st, 'FrToDt');
      var label = 'Statement ' + (si + 1) + (iban ? ' (' + iban + ')' : '');
      if (!pick) { errors.push(label + ': no closing balance in the file.'); return; }
      if (pick.ccy && pick.ccy !== 'EUR') errors.push(label + ': the account is in ' + pick.ccy + '; only EUR accounts can be used.');
      out.push({ iban: iban.replace(/\s+/g, '').toUpperCase(), currency: pick.ccy || ccy || 'EUR', owner: owner, balance: round2(pick.amount), date: pick.date, balanceType: pick.code,
        from: fr ? parseDate(txt(kid(fr, 'FrDtTm')).slice(0, 10)) : null, to: fr ? parseDate(txt(kid(fr, 'ToDtTm')).slice(0, 10)) : null, entries: entries });
    });
    if (!out.length && !errors.length) errors.push('The statement has no accounts in it.');
    return { statements: mergeStatements(out), errors: errors };
  }
  /** several statements of one account (a file with a week of daily statements): the latest balance, all entries */
  function mergeStatements(list) {
    var by = {}, order = [];
    list.forEach(function (s, i) {
      var k = s.iban || '#' + i;
      if (!by[k]) { by[k] = s; order.push(k); return; }
      var a = by[k], keep = s.date > a.date ? s : a;
      by[k] = Object.assign({}, keep, { entries: a.entries.concat(s.entries), from: [a.from, s.from].filter(Boolean).sort()[0] || null });
    });
    return order.map(function (k) { return by[k]; });
  }

  // ── bank CSV ─────────────────────────────────────────────────────────────
  var BANK_FIELDS = [
    { id: 'date', label: 'Booking date', required: true, hints: ['datum knjiženja', 'datum knjizenja', 'datum transakcije', 'booking date', 'datum izvršitve', 'datum', 'date', 'datum valute', 'value date'] },
    { id: 'balance', label: 'Balance after the transaction', required: true, hints: ['stanje po transakciji', 'novo stanje', 'stanje', 'saldo', 'balance', 'running balance', 'stanje računa'] },
    { id: 'amount', label: 'Amount (+ in, − out)', hints: ['znesek', 'amount', 'iznos'] },
    { id: 'credit', label: 'Money in (credit)', hints: ['v dobro', 'dobro', 'priliv', 'prilivi', 'credit', 'uplata', 'potražuje', 'potrazuje'] },
    { id: 'debit', label: 'Money out (debit)', hints: ['v breme', 'breme', 'odliv', 'odlivi', 'debit', 'obremenitev', 'isplata', 'duguje'] },
    { id: 'party', label: 'Counterparty', hints: ['naziv plačnika', 'naziv prejemnika', 'plačnik', 'prejemnik', 'partner', 'counterparty', 'naziv', 'name'] },
    { id: 'text', label: 'Purpose / reference', hints: ['namen', 'opis', 'sklic', 'referenca', 'reference', 'purpose', 'description', 'poziv na broj', 'svrha'] }
  ];
  /** bank CSV rows → one statement { balance, date, entries } from the balance column, or errors */
  function buildBankCsv(rows, mapping, opts) {
    opts = opts || {};
    var head = opts.headerRow || 0, errors = [], warnings = [], entries = [], last = null;
    BANK_FIELDS.forEach(function (f) { if (f.required && !(mapping[f.id] >= 0)) errors.push('Choose the column for "' + f.label + '".'); });
    if (errors.length) return { errors: errors, warnings: warnings };
    function get(r, k) { return mapping[k] >= 0 ? String(r[mapping[k]] == null ? '' : r[mapping[k]]).trim() : ''; }
    var dates = [];
    rows.slice(head + 1).forEach(function (r, i) {
      var line = head + i + 2, dRaw = get(r, 'date'), d = parseDate(dRaw), bRaw = get(r, 'balance'), b = parseNumber(bRaw);
      if (!dRaw && !bRaw) return;
      if (!d) { if (SUMMARY.test(String(r[0] || '').trim()) || SUMMARY.test(dRaw)) return; errors.push('Row ' + line + ': date "' + dRaw + '" is not a date.'); return; }
      if (isNaN(b)) { errors.push('Row ' + line + ': balance "' + bRaw + '" is not a number.'); return; }
      var amt = NaN;
      if (mapping.amount >= 0) amt = parseNumber(get(r, 'amount'));
      else if (mapping.credit >= 0 || mapping.debit >= 0) { var c = parseNumber(get(r, 'credit')) || 0, de = parseNumber(get(r, 'debit')) || 0; amt = Math.abs(c) - Math.abs(de); }
      dates.push({ d: d, b: b, line: line, amt: amt });
      if (isFinite(amt) && amt) entries.push({ date: d, amount: round2(amt), booked: true, party: get(r, 'party'), text: get(r, 'text').slice(0, 400) });
    });
    if (!dates.length && !errors.length) errors.push('No rows with a date and a balance.');
    if (errors.length) return { errors: errors, warnings: warnings };
    // the newest date's balance; on that day, the last row in time (the file may be newest-first)
    var newestFirst = dates.length > 1 && dates[0].d > dates[dates.length - 1].d;
    var maxD = dates.reduce(function (m, x) { return x.d > m ? x.d : m; }, dates[0].d);
    var sameDay = dates.filter(function (x) { return x.d === maxD; });
    last = newestFirst ? sameDay[0] : sameDay[sameDay.length - 1];
    if (sameDay.length > 1) {
      // the day's last transaction: its balance is not the balance before any other transaction of that day
      var before = {}, ends;
      if (sameDay.every(function (x) { return isFinite(x.amt); })) {
        sameDay.forEach(function (x) { before[round2(x.b - x.amt).toFixed(2)] = 1; });
        ends = sameDay.filter(function (x) { return !before[round2(x.b).toFixed(2)]; });
      }
      if (ends && ends.length === 1) last = ends[0];
      else warnings.push(sameDay.length + ' rows on ' + maxD + ': the balance of the ' + (newestFirst ? 'first' : 'last') + ' one is used (row ' + last.line + '). Check it against your e-bank.');
    }
    return { errors: [], warnings: warnings, statement: { iban: opts.iban || '', currency: 'EUR', owner: '', balance: round2(last.b), date: maxD, balanceType: 'CSV', from: dates.reduce(function (m, x) { return x.d < m ? x.d : m; }, maxD), to: maxD, entries: entries } };
  }

  // ── payments in a statement that settle open invoices ────────────────────
  function tokens(text) {
    var out = {};
    String(text || '').split(/[\s,;:()·]+/).forEach(function (t) {
      var n = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (n.length < 3) return;
      out[n] = 1;
      var m = /^(SI\d{2}|HR\d{2}|RF\d{2})(.+)$/.exec(n); if (m && m[2].length >= 3) out[m[2]] = 1;
    });
    return out;
  }
  /** Booked statement entries that pay exactly one open invoice: same amount (to the cent) and the invoice number in
   * the reference, purpose or end-to-end ID. Money in → receivables, money out → payables. One entry ↔ one invoice;
   * anything ambiguous is left alone. open: [{ id, no, amount, kind: 'ar'|'ap', issued }] */
  function matchPayments(entries, open) {
    var cand = [];
    (entries || []).forEach(function (e, ei) {
      if (!e.booked || !e.amount) return;
      var tk = tokens(e.text + ' ' + (e.ref || '')), kind = e.amount > 0 ? 'ar' : 'ap', amt = Math.abs(e.amount);
      open.forEach(function (o) {
        if (o.kind !== kind || Math.abs(o.amount - amt) > EPS) return;
        var no = String(o.no || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (no.length < 4 || !tk[no]) return;
        if (o.issued && e.date && e.date < o.issued) return;
        cand.push({ ei: ei, id: o.id });
      });
    });
    var byE = {}, byO = {};
    cand.forEach(function (c) { byE[c.ei] = (byE[c.ei] || 0) + 1; byO[c.id] = (byO[c.id] || 0) + 1; });
    return cand.filter(function (c) { return byE[c.ei] === 1 && byO[c.id] === 1; }).map(function (c) { return { entry: entries[c.ei], id: c.id }; });
  }

  return {
    decodeBytes: decodeBytes, encodingOf: encodingOf, parseCsv: parseCsv, parseNumber: parseNumber, parseDate: parseDate,
    FIELDS: FIELDS, BANK_FIELDS: BANK_FIELDS, guessMapping: guessMapping, findHeaderRow: findHeaderRow, buildOpenItems: buildOpenItems, normName: normName,
    parseXml: parseXml, parseCamt: parseCamt, buildBankCsv: buildBankCsv, matchPayments: matchPayments
  };
});
