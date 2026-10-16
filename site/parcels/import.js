/* Parcels & COD: read carrier COD payout (remittance) files and bank statements, and match them to the COD parcels
 * and payout batches. Pure functions: no storage, no network, no DOM (except an optional DOMParser for XML).
 * Browser: window.ParcelsImport. Node (tests): module.exports. Test: node tools/tests/parcels-import.test.js
 *
 *  - CSV: sniffDelimiter (; , tab), parseCsv (RFC 4180), detectDecimal (decimal comma or point), parseAmount, parseDate
 *  - header mapping: CARRIER_FIELDS / BANK_FIELDS with Slovenian, Croatian and English header names, guessMapping,
 *    mapFromSaved / mapToSaved (a mapping remembered by header name, per carrier)
 *  - readCarrierRows → payout lines; readBankRows → bank entries (signed amount, D/C column or debit/credit columns)
 *  - parseCamt053: ISO 20022 bank-to-customer statement (camt.053, also camt.052/054). Namespace-agnostic: works on the
 *    local element names, so camt.053.001.02 … .001.13 all read the same. Uses DOMParser when given one (browser),
 *    else a small built-in XML reader (Node).
 *  - matchCarrier / matchBank: matched · amount mismatch · unmatched · duplicate, with the reason for each line
 *  - buildCarrierCsv / buildCamt053 / buildBankCsv: sample files in the same formats (for the demo)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParcelsImport = api;
})(this, function () {
  'use strict';

  var EPS = 0.005;
  function r2(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.getUTCFullYear() === +s.slice(0, 4) && d.getUTCMonth() === +s.slice(5, 7) - 1 && d.getUTCDate() === +s.slice(8, 10);
  }
  function dayNo(s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5); }
  function daysApart(a, b) { return Math.abs(dayNo(a) - dayNo(b)); }
  function fold(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
  /** header name → comparable form: lower case, no diacritics, punctuation as spaces ("Št. pošiljke" → "st posiljke") */
  function normHead(h) { return fold(h).toLowerCase().replace(/[_.:;,()[\]/\\#*€-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /** a reference or tracking number for comparing: upper case letters and digits only */
  function normRef(s) { return fold(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  // ── bytes → text ─────────────────────────────────────────────────────────
  /** UTF-8 when the bytes are valid UTF-8, else Windows-1250 (older Slovenian / Croatian bank and carrier exports) */
  function decodeBytes(bytes) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; }
    catch (e) {
      try { return { text: new TextDecoder('windows-1250').decode(bytes), encoding: 'windows-1250' }; }
      catch (e2) { return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }; }
    }
  }
  function stripBom(t) { return String(t == null ? '' : t).replace(/^﻿/, ''); }

  // ── CSV ──────────────────────────────────────────────────────────────────
  /** per line, how often each candidate delimiter occurs outside quotes (first 12 non-empty lines) */
  function delimCounts(text, max) {
    var out = [], cur = { ';': 0, ',': 0, '\t': 0 }, q = false, any = false;
    for (var i = 0; i < text.length && out.length < (max || 12); i++) {
      var c = text[i];
      if (c === '"') q = !q;
      else if (!q && (c === '\n' || c === '\r')) { if (any) out.push(cur); cur = { ';': 0, ',': 0, '\t': 0 }; any = false; }
      else { if (!q && cur[c] !== undefined) cur[c]++; if (c.trim()) any = true; }
    }
    if (any && out.length < (max || 12)) out.push(cur);
    return out;
  }
  /** the delimiter that splits the header line and the following lines into the same number of columns most often
   * (ties: the one with more columns, then ; before tab before ,) — a ";" file full of decimal commas stays ";" */
  function sniffDelimiter(text) {
    var lines = delimCounts(stripBom(text)), best = ';', bestScore = -1;
    [';', '\t', ','].forEach(function (d) {
      if (!lines.length || !lines[0][d]) return;
      var same = lines.filter(function (l) { return l[d] === lines[0][d]; }).length;
      var score = same * 1000 + lines[0][d];
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }
  /** RFC 4180: quoted fields, "" escapes, delimiters and line breaks inside quotes, CRLF / LF / CR, a byte-order mark.
   * Empty rows are dropped. */
  function parseCsv(text, delim) {
    text = stripBom(text);
    delim = delim || sniffDelimiter(text);
    var rows = [], row = [], cell = '', inQ = false, n = text.length;
    for (var i = 0; i < n; i++) {
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
    return { delimiter: delim, rows: rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); }) };
  }

  // ── numbers and dates ────────────────────────────────────────────────────
  function cleanNum(s) { return String(s == null ? '' : s).replace(/EUR|€|kn|HRK/gi, '').replace(/[\s  ']/g, ''); }
  /** ',' when the amounts use a decimal comma (1.234,50 · 12,5), '.' for a decimal point (1,234.50 · 12.5);
   * a lone separator followed by exactly three digits says nothing (it may be thousands); default ',' */
  function detectDecimal(values) {
    var v = { ',': 0, '.': 0 };
    (values || []).forEach(function (raw) {
      var s = cleanNum(raw).replace(/^[(−+-]+|[)−-]+$/g, '');
      if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return;
      var c = s.lastIndexOf(','), d = s.lastIndexOf('.');
      if (c >= 0 && d >= 0) { v[c > d ? ',' : '.']++; return; }
      var at = c >= 0 ? c : d, sep = c >= 0 ? ',' : '.';
      if (at < 0) return;
      var after = s.length - at - 1, count = s.split(sep).length - 1;
      if (count === 1 && after !== 3 && after > 0) v[sep]++;
      else if (count > 1) v[sep === ',' ? '.' : ',']++; // 1.234.567 → the dots are thousands
    });
    return v['.'] > v[','] ? '.' : ',';
  }
  /** "1.234,50", "-12,30", "(12,30)", "12,30-", "1,234.50", "12.5 €" → number; NaN when it is not an amount.
   * dec = the file's decimal separator (detectDecimal); a value that clearly uses the other one is still read right. */
  function parseAmount(raw, dec) {
    var s = cleanNum(raw);
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^[−-]/.test(s)) { neg = !neg; s = s.slice(1); } else if (/^\+/.test(s)) s = s.slice(1);
    if (/[−-]$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    dec = dec === '.' ? '.' : ',';
    var other = dec === ',' ? '.' : ',', c = s.lastIndexOf(dec), o = s.lastIndexOf(other);
    // only the "other" separator, once, not followed by exactly 3 digits: it is the decimal separator after all
    if (c < 0 && o >= 0 && s.split(other).length === 2 && s.length - o - 1 !== 3) { var t = dec; dec = other; other = t; }
    if (s.split(dec).length > 2) return NaN;
    var parts = s.split(dec), int = parts[0], frac = parts.length > 1 ? parts[1] : '';
    if (int.indexOf(other) >= 0) {
      if (!/^\d{1,3}([.,]\d{3})+$/.test(int)) return NaN;
      int = int.split(other).join('');
    }
    if (!/^\d*$/.test(int) || !/^\d*$/.test(frac) || (!int && !frac)) return NaN;
    var n = Number((int || '0') + (frac ? '.' + frac : ''));
    return isFinite(n) ? (neg ? -n : n) : NaN;
  }
  /** 15.10.2026 · 15. 10. 2026 · 15.10.2026. · 15/10/2026 · 2026-10-15 · 2026-10-15T08:30 · 20261015 · 15.10.26 → '2026-10-15' */
  function parseDate(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?$/, '').trim();
    var m, d;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) d = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    else if ((m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}|\d{2})\.?$/.exec(s)) || (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) d = (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) d = m[1] + '-' + m[2] + '-' + m[3];
    return d && isDate(d) ? d : null;
  }

  // ── header mapping ───────────────────────────────────────────────────────
  // hints are compared after normHead (no diacritics, lower case); earlier hints and exact matches win.
  // Fields are mapped in this order, so "Znesek odkupnine" goes to COD before "Znesek" is looked for.
  var CARRIER_FIELDS = [
    { id: 'tracking', label: 'Tracking number', required: true, hints: ['stevilka posiljke', 'st posiljke', 'broj posiljke', 'br posiljke', 'tracking number', 'tracking no', 'parcel number', 'parcel no', 'tracking', 'sledilna stevilka', 'crtna koda', 'barcode', 'broj paketa', 'stevilka paketa', 'paket', 'posiljka', 'parcel', 'shipment', 'awb', 'numero spedizione', 'spedizione'] },
    { id: 'cod', label: 'COD amount (collected)', hints: ['odkupnina', 'znesek odkupnine', 'otkupnina', 'iznos otkupnine', 'pouzece', 'pouzetje', 'cod amount', 'cod', 'cash on delivery', 'contrassegno', 'collected', 'gross'] },
    { id: 'fee', label: 'Fee', hints: ['provizija', 'nadomestilo', 'strosek', 'stroski', 'naknada', 'provizija prijevoznika', 'fee', 'commission', 'charge', 'commissione'] },
    { id: 'amount', label: 'Amount paid out', required: true, hints: ['znesek izplacila', 'izplacilo', 'izplacano', 'za izplacilo', 'znesek', 'iznos isplate', 'isplaceno', 'za isplatu', 'iznos', 'paid out', 'payout amount', 'net amount', 'paid', 'net', 'amount', 'importo', 'payout'] },
    { id: 'date', label: 'Payout date', hints: ['datum izplacila', 'datum nakazila', 'datum placila', 'datum isplate', 'datum uplate', 'payout date', 'payment date', 'paid on', 'date', 'datum', 'data'] },
    { id: 'ref', label: 'Payout reference', hints: ['sklic', 'referenca', 'stevilka izplacila', 'st izplacila', 'specifikacija', 'poziv na broj', 'broj isplate', 'referenca isplate', 'payout reference', 'payout ref', 'batch', 'reference', 'ref', 'riferimento'] },
    { id: 'order', label: 'Order number', hints: ['stevilka narocila', 'st narocila', 'narocilo', 'broj narudzbe', 'narudzba', 'order number', 'order no', 'order', 'ordine'] }
  ];
  var BANK_FIELDS = [
    { id: 'date', label: 'Booking date', required: true, hints: ['datum knjizenja', 'knjizeno', 'datum izvrsitve', 'datum izvrsenja', 'datum transakcije', 'datum valute', 'booking date', 'posting date', 'value date', 'date', 'datum'] },
    { id: 'dc', label: 'Debit / credit marker', hints: ['breme dobro', 'dobro breme', 'd c', 'c d', 'dc', 'cdtdbtind', 'credit debit', 'debit credit', 'smer', 'oznaka', 'duguje potrazuje', 'vrsta prometa'] },
    { id: 'credit', label: 'Credit (money in)', hints: ['v dobro', 'dobro', 'priliv', 'prilivi', 'potrazuje', 'uplata', 'uplate', 'credit', 'money in', 'paid in', 'incoming'] },
    { id: 'debit', label: 'Debit (money out)', hints: ['v breme', 'breme', 'odliv', 'odlivi', 'duguje', 'isplata', 'isplate', 'debit', 'money out', 'paid out', 'outgoing'] },
    { id: 'amount', label: 'Amount (signed)', hints: ['znesek', 'iznos', 'amount', 'value', 'importo'] },
    { id: 'ref', label: 'Reference', hints: ['referenca prejemnika', 'sklic prejemnika', 'referenca', 'sklic', 'poziv na broj primatelja', 'poziv na broj', 'model i poziv', 'creditor reference', 'reference', 'end to end', 'endtoendid', 'ref'] },
    { id: 'text', label: 'Purpose / details', hints: ['namen placila', 'namen', 'opis placila', 'opis', 'svrha placanja', 'svrha', 'opis placanja', 'purpose', 'details', 'description', 'remittance information', 'remittance', 'narrative', 'text', 'causale'] },
    { id: 'party', label: 'Counterparty', hints: ['naziv placnika', 'placnik', 'partner', 'naziv partnerja', 'nalogodavac', 'platitelj', 'naziv', 'counterparty', 'payer', 'name'] }
  ];
  /** column index for each field (-1 when not found), guessed from the header names */
  function guessMapping(headers, fields) {
    var H = (headers || []).map(normHead), used = {}, map = {};
    fields.forEach(function (f) {
      var best = -1, bestScore = 0;
      H.forEach(function (h, i) {
        if (used[i] || !h) return;
        f.hints.forEach(function (hint, k) {
          var sc = h === hint ? 300 - k : (h.indexOf(hint + ' ') === 0 ? 200 - k : ((' ' + h + ' ').indexOf(' ' + hint + ' ') >= 0 ? 100 - k : 0));
          if (sc > bestScore) { bestScore = sc; best = i; }
        });
      });
      map[f.id] = best;
      if (best >= 0) used[best] = 1;
    });
    return map;
  }
  /** a remembered mapping { field: header name } → indexes for these headers; fields it does not name are guessed */
  function mapFromSaved(headers, saved, fields) {
    var H = (headers || []).map(normHead), map = guessMapping(headers, fields), hit = 0;
    if (saved && typeof saved === 'object') {
      fields.forEach(function (f) {
        if (!(f.id in saved)) return;
        if (saved[f.id] === '') { map[f.id] = -1; return; }
        var i = H.indexOf(normHead(saved[f.id]));
        if (i >= 0) { Object.keys(map).forEach(function (k) { if (map[k] === i) map[k] = -1; }); map[f.id] = i; hit++; }
      });
    }
    return { map: map, fromSaved: hit > 0 };
  }
  function mapToSaved(headers, map) {
    var out = {};
    Object.keys(map).forEach(function (k) { out[k] = map[k] >= 0 && headers[map[k]] != null ? String(headers[map[k]]).slice(0, 80) : ''; });
    return out;
  }
  function missingRequired(map, fields) { return fields.filter(function (f) { return f.required && !(map[f.id] >= 0); }).map(function (f) { return f.label; }); }
  function col(row, i) { return i >= 0 && i < row.length ? String(row[i] == null ? '' : row[i]).trim() : ''; }
  function colValues(rows, i) { var v = []; if (i >= 0) rows.forEach(function (r) { var x = col(r, i); if (x) v.push(x); }); return v; }
  var TOTAL_RE = /^(skupaj|skupno|ukupno|total|totale|sum|vsota|zbir)\b/i;

  /** carrier remittance rows (header first) → payout lines.
   * amount = what the carrier paid out for the parcel: the "amount" column, else COD − fee, else (basis 'gross') the COD
   * column alone, which is then compared with the parcel's COD instead of the net payout. */
  function readCarrierRows(rows, map, opts) {
    opts = opts || {};
    var body = rows.slice(1), lines = [], errors = [], skipped = 0;
    var dec = opts.dec || detectDecimal(colValues(body, map.amount).concat(colValues(body, map.cod), colValues(body, map.fee)));
    var basis = map.amount >= 0 || (map.cod >= 0 && map.fee >= 0) ? 'net' : map.cod >= 0 ? 'gross' : 'net';
    body.forEach(function (r, i) {
      var n = i + 2, trk = col(r, map.tracking), first = col(r, 0);
      if (!trk) { if (TOTAL_RE.test(fold(first)) || r.every(function (x, j) { return j === map.amount || j === map.cod || j === map.fee || !String(x).trim(); })) skipped++; else errors.push({ n: n, msg: 'No tracking number' }); return; }
      if (TOTAL_RE.test(fold(trk))) { skipped++; return; }
      var amount = map.amount >= 0 ? parseAmount(col(r, map.amount), dec) : NaN;
      var cod = map.cod >= 0 ? parseAmount(col(r, map.cod), dec) : NaN, fee = map.fee >= 0 ? parseAmount(col(r, map.fee), dec) : NaN;
      if (map.amount < 0 && isFinite(cod) && isFinite(fee)) amount = r2(cod - Math.abs(fee));
      if (basis === 'gross') amount = cod;
      if (!isFinite(amount)) { errors.push({ n: n, msg: 'Amount “' + (col(r, map.amount) || col(r, map.cod)) + '” is not a number', tracking: trk }); return; }
      var rawDate = col(r, map.date), date = rawDate ? parseDate(rawDate) : null;
      if (rawDate && !date) { errors.push({ n: n, msg: 'Date “' + rawDate + '” is not a date', tracking: trk }); return; }
      lines.push({ n: n, tracking: trk, key: normRef(trk), amount: r2(amount), cod: isFinite(cod) ? r2(cod) : null, fee: isFinite(fee) ? r2(Math.abs(fee)) : null, date: date, ref: col(r, map.ref), order: col(r, map.order) });
    });
    return { lines: lines, errors: errors, skipped: skipped, dec: dec, basis: basis };
  }

  /** debit/credit marker → 'C' | 'D' | ''. Slovenian banks write B (breme, debit) / D (dobro, credit): when the column
   * uses B anywhere, D means credit. */
  function dcOf(v, slovenian) {
    var s = normHead(v).replace(/\s/g, '');
    if (!s) return '';
    if (/^(c|cr|crdt|credit|dobro|vdobro|priliv|potrazuje|p|in|\+)$/.test(s)) return 'C';
    if (/^(b|breme|vbreme|odliv|dbit|debit|dr|duguje|out|-)$/.test(s)) return 'D';
    if (s === 'd') return slovenian ? 'C' : 'D';
    return '';
  }
  /** bank CSV rows (header first) → entries in the same shape as parseCamt053's */
  function readBankRows(rows, map, opts) {
    opts = opts || {};
    var body = rows.slice(1), entries = [], errors = [], skipped = 0;
    var dec = opts.dec || detectDecimal(colValues(body, map.amount).concat(colValues(body, map.credit), colValues(body, map.debit)));
    var slo = map.dc >= 0 && colValues(body, map.dc).some(function (v) { return /^b$/i.test(v.trim()) || /breme/i.test(fold(v)); });
    body.forEach(function (r, i) {
      var n = i + 2, rawDate = col(r, map.date), date = parseDate(rawDate);
      if (!rawDate && TOTAL_RE.test(fold(col(r, 0)))) { skipped++; return; }
      if (!date) { if (!rawDate && !r.some(function (x) { return /\d/.test(x); })) { skipped++; return; } errors.push({ n: n, msg: rawDate ? 'Date “' + rawDate + '” is not a date' : 'No booking date' }); return; }
      var amt = NaN, cd = '';
      var cr = map.credit >= 0 ? parseAmount(col(r, map.credit), dec) : NaN, db = map.debit >= 0 ? parseAmount(col(r, map.debit), dec) : NaN;
      if (isFinite(cr) && Math.abs(cr) > EPS) { amt = Math.abs(cr); cd = cr < 0 ? 'D' : 'C'; }
      else if (isFinite(db) && Math.abs(db) > EPS) { amt = Math.abs(db); cd = db < 0 ? 'C' : 'D'; }
      else if (map.amount >= 0) {
        var a = parseAmount(col(r, map.amount), dec);
        if (isFinite(a)) { var m = map.dc >= 0 ? dcOf(col(r, map.dc), slo) : ''; amt = Math.abs(a); cd = m ? (a < 0 ? (m === 'C' ? 'D' : 'C') : m) : (a < 0 ? 'D' : 'C'); }
      }
      if (!isFinite(amt)) { errors.push({ n: n, msg: 'No amount' }); return; }
      var ref = col(r, map.ref), text = col(r, map.text);
      entries.push({ n: n, amount: r2(amt), ccy: 'EUR', cd: cd === 'D' ? 'DBIT' : 'CRDT', bookDate: date, valDate: date, refs: ref ? [ref] : [], text: text, party: col(r, map.party), acctRef: '', status: 'BOOK' });
    });
    return { entries: entries, errors: errors, skipped: skipped, dec: dec };
  }

  // ── XML (camt.053) ───────────────────────────────────────────────────────
  // tree node: { n: local name, a: { attr: value }, c: [child nodes], t: own text }
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unent(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') { var cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(cp) ? String.fromCodePoint(cp) : m; }
      return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
    });
  }
  function local(name) { var i = name.indexOf(':'); return i >= 0 ? name.slice(i + 1) : name; }
  /** small XML reader for Node (tests): elements, attributes, text, entities, CDATA; comments, PIs and DOCTYPE skipped */
  function parseXmlLite(text) {
    var s = stripBom(text), i = 0, n = s.length, stack = [], rootNode = null;
    function fail(msg) { throw new Error('Not valid XML: ' + msg); }
    while (i < n) {
      var lt = s.indexOf('<', i);
      if (lt < 0) { if (stack.length && s.slice(i).trim()) stack[stack.length - 1].t += unent(s.slice(i)); break; }
      if (lt > i && stack.length) stack[stack.length - 1].t += unent(s.slice(i, lt));
      if (s.startsWith('<!--', lt)) { var ce = s.indexOf('-->', lt + 4); if (ce < 0) fail('unclosed comment'); i = ce + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { var de = s.indexOf(']]>', lt + 9); if (de < 0) fail('unclosed CDATA'); if (stack.length) stack[stack.length - 1].t += s.slice(lt + 9, de); i = de + 3; continue; }
      if (s.startsWith('<?', lt)) { var pe = s.indexOf('?>', lt + 2); if (pe < 0) fail('unclosed declaration'); i = pe + 2; continue; }
      if (s.startsWith('<!', lt)) { var be = s.indexOf('>', lt + 2); if (be < 0) fail('unclosed DOCTYPE'); i = be + 1; continue; }
      var gt = lt + 1, q = '';
      for (; gt < n; gt++) { var ch = s[gt]; if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
      if (gt >= n) fail('unclosed tag');
      var tag = s.slice(lt + 1, gt);
      i = gt + 1;
      if (tag[0] === '/') {
        var nm = local(tag.slice(1).trim()), top = stack.pop();
        if (!top || top.n !== nm) fail('</' + nm + '> does not close <' + (top ? top.n : '') + '>');
        continue;
      }
      var self = /\/\s*$/.test(tag); if (self) tag = tag.replace(/\/\s*$/, '');
      var m = /^([^\s/>]+)/.exec(tag); if (!m) fail('empty tag');
      var node = { n: local(m[1]), a: {}, c: [], t: '' }, ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, am;
      while ((am = ar.exec(tag.slice(m[1].length)))) node.a[local(am[1])] = unent(am[3] != null ? am[3] : am[4]);
      if (stack.length) stack[stack.length - 1].c.push(node); else if (!rootNode) rootNode = node; else fail('two root elements');
      if (!self) stack.push(node);
    }
    if (stack.length) fail('<' + stack[stack.length - 1].n + '> is not closed');
    if (!rootNode) fail('no root element');
    return rootNode;
  }
  function fromDom(el) {
    var node = { n: el.localName || local(el.nodeName), a: {}, c: [], t: '' };
    for (var i = 0; i < el.attributes.length; i++) node.a[el.attributes[i].localName || local(el.attributes[i].name)] = el.attributes[i].value;
    for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
      if (ch.nodeType === 1) node.c.push(fromDom(ch));
      else if (ch.nodeType === 3 || ch.nodeType === 4) node.t += ch.nodeValue;
    }
    return node;
  }
  function parseXml(text, DP) {
    if (DP) {
      var doc = new DP().parseFromString(stripBom(text), 'application/xml');
      var err = doc.getElementsByTagName('parsererror')[0];
      if (err || !doc.documentElement) throw new Error('Not valid XML: ' + (err ? String(err.textContent || '').replace(/^\s*This page contains the following errors:\s*/i, '').split(/Below is a rendering|\n/)[0].trim().slice(0, 160) : 'empty'));
      return fromDom(doc.documentElement);
    }
    return parseXmlLite(text);
  }
  function kid(node, name) { if (!node) return null; for (var i = 0; i < node.c.length; i++) if (node.c[i].n === name) return node.c[i]; return null; }
  function kids(node, name) { return node ? node.c.filter(function (x) { return x.n === name; }) : []; }
  function at(node, path) { path.split('/').forEach(function (p) { node = kid(node, p); }); return node; }
  function txt(node) { return node ? String(node.t).trim() : ''; }
  function all(node, name, out) { out = out || []; if (!node) return out; node.c.forEach(function (x) { if (x.n === name) out.push(x); all(x, name, out); }); return out; }
  function dateOf(node) { if (!node) return null; return parseDate(txt(kid(node, 'Dt')) || txt(kid(node, 'DtTm')) || txt(node)); }
  function amtOf(node) { if (!node) return NaN; var v = Number(txt(node).replace(',', '.')); return isFinite(v) ? v : NaN; }
  function cdOf(node) { var s = txt(kid(node, 'CdtDbtInd')).toUpperCase(); return s === 'DBIT' || s === 'CRDT' ? s : ''; }
  function partyName(p) { return p ? txt(kid(p, 'Nm')) || txt(at(p, 'Pty/Nm')) : ''; }
  /** remittance and reference texts of a transaction (or entry): structured refs first, then the free text */
  function refsOf(node) {
    var refs = [], text = [];
    all(node, 'RmtInf').forEach(function (ri) {
      kids(ri, 'Ustrd').forEach(function (u) { if (txt(u)) text.push(txt(u)); });
      kids(ri, 'Strd').forEach(function (s) {
        all(s, 'CdtrRefInf').forEach(function (c) { var r = txt(kid(c, 'Ref')); if (r) refs.push(r); });
        all(s, 'RfrdDocInf').forEach(function (d) { var r = txt(kid(d, 'Nb')); if (r) refs.push(r); });
        kids(s, 'AddtlRmtInf').forEach(function (a) { if (txt(a)) text.push(txt(a)); });
      });
    });
    return { refs: refs, text: text };
  }

  /** camt.053 (or camt.052 / camt.054) text → { stmts: [{ id, iban, ccy, from, to }], entries: [...] }.
   * One entry per Ntry; an Ntry with several TxDtls that carry their own amounts (a batch booking) becomes one entry
   * per transaction. Entry: { n, amount (positive), ccy, cd: 'CRDT'|'DBIT', bookDate, valDate, refs[], text, party,
   * acctRef, e2e, status, reversal, iban, stmt }. Throws on text that is not camt XML. */
  function parseCamt053(text, opts) {
    opts = opts || {};
    var tree = parseXml(text, opts.DOMParser), stmts = [], entries = [];
    var groups = all(tree, 'Stmt').concat(all(tree, 'Rpt'), all(tree, 'Ntfctn'));
    if (tree.n !== 'Document' && !groups.length) throw new Error('This XML is not a camt bank statement (no Document / Stmt element).');
    if (!groups.length) throw new Error('No statement (Stmt) in this camt file.');
    groups.forEach(function (g) {
      var iban = txt(at(g, 'Acct/Id/IBAN')) || txt(at(g, 'Acct/Id/Othr/Id'));
      var st = { id: txt(kid(g, 'Id')), iban: iban, ccy: txt(at(g, 'Acct/Ccy')), from: parseDate(txt(at(g, 'FrToDt/FrDtTm'))), to: parseDate(txt(at(g, 'FrToDt/ToDtTm'))), created: parseDate(txt(kid(g, 'CreDtTm'))), entries: 0 };
      stmts.push(st);
      kids(g, 'Ntry').forEach(function (e, ei) {
        var amtN = kid(e, 'Amt'), base = {
          amount: amtOf(amtN), ccy: amtN && amtN.a.Ccy || st.ccy || 'EUR', cd: cdOf(e), bookDate: dateOf(kid(e, 'BookgDt')), valDate: dateOf(kid(e, 'ValDt')),
          acctRef: txt(kid(e, 'AcctSvcrRef')), status: txt(kid(e, 'Sts')) || txt(at(e, 'Sts/Cd')), reversal: /^true$/i.test(txt(kid(e, 'RvslInd'))),
          addtl: txt(kid(e, 'AddtlNtryInf')), iban: iban, stmt: st.id
        };
        var txs = all(e, 'TxDtls');
        var split = txs.length > 1 && txs.every(function (t) { return isFinite(amtOf(kid(t, 'Amt'))) || isFinite(amtOf(at(t, 'AmtDtls/TxAmt/Amt'))); });
        (split ? txs : [null]).forEach(function (t, ti) {
          var src = t || e, ro = refsOf(src), refs = ro.refs.slice(), texts = ro.text.slice();
          var e2e = '';
          (t ? [t] : txs).forEach(function (x) {
            var r = kid(x, 'Refs');
            e2e = e2e || txt(kid(r, 'EndToEndId'));
            ['EndToEndId', 'InstrId', 'PmtInfId', 'MsgId', 'TxId'].forEach(function (k) { var v = txt(kid(r, k)); if (v && !/^NOTPROVIDED$/i.test(v) && refs.indexOf(v) < 0) refs.push(v); });
            var ad = txt(kid(x, 'AddtlTxInf')); if (ad) texts.push(ad);
          });
          if (base.addtl) texts.push(base.addtl);
          var rp = t ? kid(t, 'RltdPties') : at(e, 'NtryDtls/TxDtls/RltdPties');
          var cdT = t ? cdOf(t) : '';
          var amount = t ? (isFinite(amtOf(kid(t, 'Amt'))) ? amtOf(kid(t, 'Amt')) : amtOf(at(t, 'AmtDtls/TxAmt/Amt'))) : base.amount;
          var cd = cdT || base.cd;
          entries.push({
            n: entries.length + 1, ix: ei + 1 + (split ? '.' + (ti + 1) : ''), amount: r2(Math.abs(amount)), ccy: base.ccy, cd: cd, bookDate: base.bookDate || base.valDate, valDate: base.valDate || base.bookDate,
            refs: refs, text: texts.filter(function (x, i) { return texts.indexOf(x) === i; }).join(' · '), party: partyName(kid(rp, cd === 'DBIT' ? 'Cdtr' : 'Dbtr')),
            acctRef: base.acctRef, e2e: e2e, status: base.status, reversal: base.reversal, iban: base.iban, stmt: base.stmt
          });
          st.entries++;
        });
      });
    });
    entries.forEach(function (x) { if (!isFinite(x.amount) || !x.cd || !x.bookDate) x.bad = !isFinite(x.amount) ? 'no amount' : !x.cd ? 'no CdtDbtInd' : 'no booking date'; });
    return { stmts: stmts, entries: entries };
  }

  // ── matching ─────────────────────────────────────────────────────────────
  /** Carrier payout lines → parcels. find(key) returns the parcel for a normalised tracking number (or null):
   *   { pid, order, carrier, cod, net, delivered, returned, batch: { id, ref, paid, expected } | null, imported: { ref } | null }
   * Result per line: { line, pid, status: 'matched'|'mismatch'|'unmatched'|'duplicate', kind, expected, diff, apply, note }
   *   kind 'new'      delivered, in no payout batch yet: the line is the payout (apply records it)
   *   kind 'batch'    already in a payout batch: the line confirms it (or shows the known difference)
   *   kind 'returned' the carrier pays for a parcel that came back (apply records it, so it shows as "paid but returned")
   *   kind 'early'    paid but not delivered per the scans · 'unknown' / 'notcod' / 'carrier' / 'again' / 'twice' */
  function matchCarrier(lines, opts) {
    opts = opts || {};
    var find = opts.find, carrier = opts.carrier || '', seen = {}, out = [], basis = opts.basis || 'net';
    lines.forEach(function (ln) {
      var p = find(ln.key) || (ln.key.replace(/^0+/, '') !== ln.key ? find(ln.key.replace(/^0+/, '')) : null);
      var r = { line: ln, pid: p ? p.pid : null, status: 'unmatched', kind: 'unknown', expected: null, diff: null, apply: false, note: '' };
      out.push(r);
      if (!p) { r.note = 'No parcel with this tracking number'; return; }
      if (seen[p.pid]) { r.status = 'duplicate'; r.kind = 'twice'; r.note = 'Same parcel as line ' + seen[p.pid]; return; }
      seen[p.pid] = ln.n;
      if (!p.cod) { r.kind = 'notcod'; r.note = 'Prepaid parcel: no COD to pay out'; return; }
      if (carrier && p.carrier !== carrier) { r.kind = 'carrier'; r.note = 'This parcel was sent with ' + (p.carrierName || p.carrier); return; }
      r.expected = basis === 'gross' ? p.cod : (p.batch ? p.batch.expected : p.net);
      r.diff = r2(ln.amount - r.expected);
      var same = Math.abs(r.diff) <= EPS;
      if (p.imported) { r.status = 'duplicate'; r.kind = 'again'; r.note = 'Already imported (payout ' + (p.imported.ref || 'without reference') + ')'; return; }
      if (p.batch) {
        r.kind = 'batch'; r.status = same ? 'matched' : 'mismatch';
        r.note = same ? 'Confirms payout batch ' + p.batch.ref : (Math.abs(ln.amount - p.batch.paid) <= EPS ? 'Same as batch ' + p.batch.ref + ': the difference is already in Mismatches' : 'Batch ' + p.batch.ref + ' shows ' + p.batch.paid.toFixed(2).replace('.', ','));
        return;
      }
      if (p.returned) { r.kind = 'returned'; r.status = 'mismatch'; r.expected = 0; r.diff = r2(ln.amount); r.note = 'Paid for a parcel that came back to us'; return; }
      if (!p.delivered) { r.kind = 'early'; r.status = 'mismatch'; r.note = 'Paid, but the parcel is not delivered according to the scans'; return; }
      r.kind = 'new'; r.status = same ? 'matched' : 'mismatch'; r.apply = same;
      r.note = same ? 'Payout for a parcel that was in no batch' : (r.diff < 0 ? 'Paid less than COD minus the agreed fee' : 'Paid more than expected');
    });
    return out;
  }
  /** Bank entries → payout targets [{ key, ref, amount, date, account, done }].
   * Credit lines only (debits and reversals are 'ignored'). First by reference (the target's reference found in the
   * line's references or text), then by the exact amount within ±tolDays of the expected date (only when exactly one
   * target fits). A target can be matched once per file; done = already confirmed by an earlier import ('duplicate'). */
  function matchBank(entries, targets, opts) {
    opts = opts || {};
    var tol = opts.tolDays == null ? 5 : opts.tolDays, iban = normRef(opts.iban || ''), used = {}, out = [];
    var T = targets.map(function (t) { return { t: t, k: normRef(t.ref), acc: normRef(t.account || '') }; });
    entries.forEach(function (e) {
      var r = { entry: e, key: null, status: 'unmatched', by: '', expected: null, diff: null, apply: false, note: '' };
      out.push(r);
      if (e.bad) { r.note = 'Unreadable line: ' + e.bad; return; }
      if (e.cd === 'DBIT') { r.status = 'ignored'; r.note = 'Money out (debit)'; return; }
      if (e.reversal) { r.status = 'ignored'; r.note = 'Reversal'; return; }
      if (/^PDNG$/i.test(e.status || '')) { r.status = 'ignored'; r.note = 'Pending, not booked yet'; return; }
      var acc = normRef(e.iban || '') || iban;
      var hay = normRef((e.refs || []).join(' ') + ' ' + (e.text || ''));
      var byRef = T.filter(function (x) { return x.k.length >= 6 && hay.indexOf(x.k) >= 0 && (!acc || !x.acc || acc === x.acc); });
      if (byRef.length > 1) byRef.sort(function (a, b) { return b.k.length - a.k.length; });
      var hit = byRef[0] || null;
      if (hit) r.by = 'reference';
      else {
        var cand = T.filter(function (x) { return !used[x.t.key] && !x.t.done && Math.abs(x.t.amount - e.amount) <= EPS && x.t.date && e.bookDate && daysApart(x.t.date, e.bookDate) <= tol && (!acc || !x.acc || acc === x.acc); });
        if (cand.length === 1) { hit = cand[0]; r.by = 'amount and date'; }
        else if (cand.length > 1) { r.note = cand.length + ' payouts have this amount: add the reference to match'; return; }
      }
      if (!hit) { r.note = 'No payout with this reference or amount'; return; }
      r.key = hit.t.key; r.expected = hit.t.amount; r.diff = r2(e.amount - hit.t.amount);
      if (used[hit.t.key]) { r.status = 'duplicate'; r.note = 'Same payout as line ' + used[hit.t.key]; return; }
      used[hit.t.key] = String(e.ix || e.n || '?');
      if (hit.t.done) { r.status = 'duplicate'; r.note = 'Already confirmed by an earlier import'; return; }
      if (Math.abs(r.diff) <= EPS) { r.status = 'matched'; r.apply = true; r.note = 'Matched by ' + r.by; }
      else { r.status = 'mismatch'; r.note = 'Reference matches, but the bank received ' + (r.diff < 0 ? 'less' : 'more') + ' than the payout'; }
    });
    return out;
  }
  function summary(results) {
    var s = { matched: 0, mismatch: 0, unmatched: 0, duplicate: 0, ignored: 0, apply: 0, total: results.length };
    results.forEach(function (r) { s[r.status] = (s[r.status] || 0) + 1; if (r.apply) s.apply++; });
    return s;
  }

  // ── sample files ─────────────────────────────────────────────────────────
  function dmy(d) { return d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : ''; }
  function comma(n) { return n == null ? '' : r2(n).toFixed(2).replace('.', ','); }
  function csvCell(v, delim) { v = String(v == null ? '' : v); return v.indexOf(delim) >= 0 || /["\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(rows, delim) { return '﻿' + rows.map(function (r) { return r.map(function (c) { return csvCell(c, delim); }).join(delim); }).join('\r\n') + '\r\n'; }
  var CARRIER_HEADS = {
    sl: ['Številka pošiljke', 'Številka naročila', 'Datum izplačila', 'Odkupnina', 'Provizija', 'Znesek izplačila', 'Sklic'],
    hr: ['Broj pošiljke', 'Broj narudžbe', 'Datum isplate', 'Otkupnina', 'Naknada', 'Iznos', 'Poziv na broj'],
    en: ['Tracking', 'Order', 'Date', 'COD', 'Fee', 'Amount', 'Reference']
  };
  /** lines [{ tracking, order, date, cod, fee, amount, ref }] → a carrier remittance CSV: sl / hr use ";", decimal
   * commas and dd.mm.yyyy; en uses ",", decimal points and ISO dates (so the reader has to detect both) */
  function buildCarrierCsv(lines, lang) {
    lang = CARRIER_HEADS[lang] ? lang : 'sl';
    var en = lang === 'en', rows = [CARRIER_HEADS[lang]], tot = 0;
    lines.forEach(function (l) {
      tot += l.amount;
      rows.push([l.tracking, l.order || '', en ? l.date : dmy(l.date), en ? r2(l.cod).toFixed(2) : comma(l.cod), en ? r2(l.fee).toFixed(2) : comma(l.fee), en ? r2(l.amount).toFixed(2) : comma(l.amount), l.ref || '']);
    });
    rows.push([en ? 'Total' : lang === 'hr' ? 'Ukupno' : 'Skupaj', '', '', '', '', en ? r2(tot).toFixed(2) : comma(tot), '']);
    return toCsv(rows, en ? ',' : ';');
  }
  function xesc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); }
  /** stmt { id, iban, from, to, created, opening } + entries [{ amount, cd, bookDate, valDate, ref?, ustrd?, addtl?, party?, acctRef?, e2e? }]
   * → camt.053.001.08 XML. ref goes to RmtInf/Strd/CdtrRefInf/Ref, ustrd to RmtInf/Ustrd, addtl to AddtlNtryInf. */
  function buildCamt053(stmt, entries) {
    var bal = stmt.opening || 0, x = [];
    x.push('<?xml version="1.0" encoding="UTF-8"?>');
    x.push('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">');
    x.push(' <BkToCstmrStmt>');
    x.push('  <GrpHdr><MsgId>' + xesc(stmt.id) + '</MsgId><CreDtTm>' + xesc(stmt.created || stmt.to) + 'T07:00:00</CreDtTm></GrpHdr>');
    x.push('  <Stmt>');
    x.push('   <Id>' + xesc(stmt.id) + '</Id><CreDtTm>' + xesc(stmt.created || stmt.to) + 'T07:00:00</CreDtTm>');
    x.push('   <FrToDt><FrDtTm>' + xesc(stmt.from) + 'T00:00:00</FrDtTm><ToDtTm>' + xesc(stmt.to) + 'T23:59:59</ToDtTm></FrToDt>');
    x.push('   <Acct><Id><IBAN>' + xesc(String(stmt.iban || '').replace(/\s/g, '')) + '</IBAN></Id><Ccy>EUR</Ccy><Ownr><Nm>' + xesc(stmt.owner || '') + '</Nm></Ownr></Acct>');
    x.push('   <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">' + r2(bal).toFixed(2) + '</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>' + xesc(stmt.from) + '</Dt></Dt></Bal>');
    entries.forEach(function (e) { bal += e.cd === 'DBIT' ? -e.amount : e.amount; });
    x.push('   <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">' + r2(Math.abs(bal)).toFixed(2) + '</Amt><CdtDbtInd>' + (bal < 0 ? 'DBIT' : 'CRDT') + '</CdtDbtInd><Dt><Dt>' + xesc(stmt.to) + '</Dt></Dt></Bal>');
    entries.forEach(function (e) {
      x.push('   <Ntry>');
      x.push('    <Amt Ccy="EUR">' + r2(e.amount).toFixed(2) + '</Amt><CdtDbtInd>' + e.cd + '</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>');
      x.push('    <BookgDt><Dt>' + xesc(e.bookDate) + '</Dt></BookgDt><ValDt><Dt>' + xesc(e.valDate || e.bookDate) + '</Dt></ValDt>');
      if (e.acctRef) x.push('    <AcctSvcrRef>' + xesc(e.acctRef) + '</AcctSvcrRef>');
      x.push('    <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>' + (e.cd === 'DBIT' ? 'ICDT' : 'RCDT') + '</Cd><SubFmlyCd>' + (e.cd === 'DBIT' ? 'CHRG' : 'ESCT') + '</SubFmlyCd></Fmly></Domn></BkTxCd>');
      x.push('    <NtryDtls><TxDtls>');
      x.push('     <Refs>' + (e.acctRef ? '<AcctSvcrRef>' + xesc(e.acctRef) + '</AcctSvcrRef>' : '') + '<EndToEndId>' + xesc(e.e2e || 'NOTPROVIDED') + '</EndToEndId></Refs>');
      x.push('     <Amt Ccy="EUR">' + r2(e.amount).toFixed(2) + '</Amt><CdtDbtInd>' + e.cd + '</CdtDbtInd>');
      if (e.party) x.push('     <RltdPties><' + (e.cd === 'DBIT' ? 'Cdtr' : 'Dbtr') + '><Pty><Nm>' + xesc(e.party) + '</Nm></Pty></' + (e.cd === 'DBIT' ? 'Cdtr' : 'Dbtr') + '></RltdPties>');
      if (e.ref || e.ustrd) {
        x.push('     <RmtInf>' + (e.ustrd ? '<Ustrd>' + xesc(e.ustrd) + '</Ustrd>' : '') + (e.ref ? '<Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>' + xesc(e.ref) + '</Ref></CdtrRefInf></Strd>' : '') + '</RmtInf>');
      }
      x.push('    </TxDtls></NtryDtls>');
      if (e.addtl) x.push('    <AddtlNtryInf>' + xesc(e.addtl) + '</AddtlNtryInf>');
      x.push('   </Ntry>');
    });
    x.push('  </Stmt>');
    x.push(' </BkToCstmrStmt>');
    x.push('</Document>');
    return x.join('\n') + '\n';
  }
  /** the same entries as a Slovenian bank CSV export: ";", decimal commas, separate debit / credit columns */
  function buildBankCsv(entries) {
    var rows = [['Datum knjiženja', 'Datum valute', 'Partner', 'V breme', 'V dobro', 'Namen', 'Referenca']];
    entries.forEach(function (e) { rows.push([dmy(e.bookDate), dmy(e.valDate || e.bookDate), e.party || '', e.cd === 'DBIT' ? comma(e.amount) : '', e.cd === 'DBIT' ? '' : comma(e.amount), e.ustrd || e.addtl || '', e.ref || '']); });
    return toCsv(rows, ';');
  }

  return {
    EPS: EPS, normHead: normHead, normRef: normRef, decodeBytes: decodeBytes,
    sniffDelimiter: sniffDelimiter, parseCsv: parseCsv, detectDecimal: detectDecimal, parseAmount: parseAmount, parseDate: parseDate,
    CARRIER_FIELDS: CARRIER_FIELDS, BANK_FIELDS: BANK_FIELDS, guessMapping: guessMapping, mapFromSaved: mapFromSaved, mapToSaved: mapToSaved, missingRequired: missingRequired,
    readCarrierRows: readCarrierRows, readBankRows: readBankRows, dcOf: dcOf,
    parseXmlLite: parseXmlLite, parseCamt053: parseCamt053,
    matchCarrier: matchCarrier, matchBank: matchBank, summary: summary,
    buildCarrierCsv: buildCarrierCsv, buildCamt053: buildCamt053, buildBankCsv: buildBankCsv
  };
});
