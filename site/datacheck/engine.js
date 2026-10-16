/* Data health check engine (Business Apps): pure parsing, validation, duplicate and scoring rules. No DOM. UMD, so it
 * also loads in Node for the tests.
 *
 *   decode(bytes) → text (UTF-8, or Windows-1250 when the bytes are not valid UTF-8)
 *   sniffDelimiter(text), csvJob(text, delim) / parseCsv(text, delim), detectHeader(rows), buildTable(rows, lines, header)
 *   guessRoles(table, home), guessType(table, roles, fileName)
 *   analysisJob(table, cfg).step(budget) … .result   (or analyze(table, cfg) in one go)
 *   applyDupes(res, table, cfg)   regroups duplicates after a threshold, survivor or "not duplicates" change
 *   planFixes(res, table, rules) / fixAll(table, cfg, rules)   every one-click fix as one value per cell, in passes
 *   viesCandidates(res, table), cfg.vies   the VAT IDs the online VIES check can confirm, and its answers as issues
 *   einvoice(res, table)   e-invoice readiness per record and overall (EN 16931 buyer fields)
 *   makeRecipe(name, type, data, rules) / matchRecipe(recipe, headers)   saved column roles and fixes for next month's file
 * Postal codes: the full official SI and HR lists come from postal-data.js (loaded before this file; required in Node).
 *
 * A result holds every issue as { r: row, c: column, k: rule id, p: detail, f: one-click fix, s: suggestion }, sorted by
 * row, plus per-rule counts, column profiles, duplicate groups and the 0–100 scores. Checksums follow the official
 * algorithms (SI tax number mod 11, Croatian OIB ISO 7064 MOD 11,10, IBAN ISO 13616 mod 97, GS1 mod 10). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var postal = null; try { postal = require('./postal-data.js'); } catch (e) { postal = null; }
    module.exports = factory(postal);
  } else root.DataCheckEngine = factory(root.DataCheckPostal || null);
})(typeof self !== 'undefined' ? self : this, function (POSTAL_DATA) {
  'use strict';

  // ── small helpers ──────────────────────────────────────────────────────
  function str(v) { return v == null ? '' : String(v); }
  function setOf(list) { var o = Object.create(null); (typeof list === 'string' ? list.split(' ') : list).forEach(function (k) { if (k) o[k] = true; }); return o; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  var DAY = 86400000;
  function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysIn(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function validYmd(y, m, d) { return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m); }
  function fromUtc(t) { var d = new Date(t); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && validYmd(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)); }
  function addDays(s, n) { return fromUtc(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) + Math.round(n) * DAY); }
  /** lower case without diacritics: "Črnomelj" → "crnomelj", "Đakovo" → "dakovo" */
  function fold(s) {
    return str(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036F]/g, '')
      .replace(/đ/g, 'd').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/œ/g, 'oe').replace(/ı/g, 'i');
  }

  // ── whitespace ─────────────────────────────────────────────────────────
  var WS_ANY = /^\s|\s$|\s\s|[\t\r\n\u00A0\u2007\u202F\u200B-\u200D\u2060\uFEFF\u2028\u2029\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  var NBSP_RE = /[\u00A0\u2007\u202F\u200B-\u200D\u2060\uFEFF]/, NBSP_G = /[\u00A0\u2007\u202F]/g, ZW_G = /[\u200B-\u200D\u2060\uFEFF]/g;
  var BREAK_RE = /[\r\n\u2028\u2029]/, CTRL_RE = /[\t\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  /** the value as the validators see it: invisible characters gone, whitespace collapsed, trimmed */
  function core(v) { v = str(v); return WS_ANY.test(v) ? v.replace(NBSP_G, ' ').replace(ZW_G, '').replace(/\s+/g, ' ').trim() : v; }
  function fixTrim(v) { return v.replace(/^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g, ''); }
  function fixDouble(v) { return v.replace(/(\S) {2,}(?=\S)/g, '$1 '); }
  function fixNbsp(v) { return v.replace(NBSP_G, ' ').replace(ZW_G, ''); }
  function fixControl(v) { return v.replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); }
  function fixBreaks(v) {
    var parts = v.split(/[ \t]*(?:\r\n|[\r\n\u2028\u2029])+[ \t]*/), out = '';
    parts.forEach(function (p, i) { if (!p) return; out += out ? (/[,;:]$/.test(out) ? ' ' : ', ') + p : p; });
    return out;
  }

  // ── placeholders ───────────────────────────────────────────────────────
  var PH = setOf(['-', '--', '---', '/', '//', '?', '??', '???', '.', '..', '...', 'x', 'xx', 'xxx', 'n/a', 'n.a.', 'n.a', 'na', 'ni',
    'ni podatka', 'ni podatkov', 'ni znano', 'brez', 'none', 'null', 'nil', 'tbd', 'ne', 'nema', 'nepoznato', 'neznano', 'unknown',
    '#n/a', '#value!', '#ref!', '#div/0!', '#name?', '#null!', '#num!', 'empty', 'prazno', '(prazno)', '(blank)', 'missing']);
  var PH_SYM = setOf(['-', '--', '---', '/', '//', '?', '??', '???', '.', '..', '...', 'n/a', 'n.a.', 'none', 'null', 'unknown', 'neznano',
    'nepoznato', '#n/a', '#value!', '(blank)', 'empty', 'prazno']);
  var PH_ZERO = setOf(['0', '00', '000', '0000', '00000', '000000', '0000000', '00000000', '00000000000']);
  var ZERO_ROLES = setOf('vat oib regno email phone iban bic ean website postal');
  function isPlaceholder(t, role) {
    var k = t.toLowerCase();
    if (role === 'country' || role === 'unit') return !!PH_SYM[k];
    if (PH[k]) return true;
    return !!(ZERO_ROLES[role] && PH_ZERO[k]);
  }

  // ── title case with legal forms ────────────────────────────────────────
  var LEGAL_ANY = { 'd.o.o.': 'd.o.o.', 'd.o.o': 'd.o.o.', 'doo': 'd.o.o.', 'j.d.o.o.': 'j.d.o.o.', 'jdoo': 'j.d.o.o.', 'd.d.': 'd.d.', 's.p.': 's.p.',
    'k.d.': 'k.d.', 'd.n.o.': 'd.n.o.', 'k.d.d.': 'k.d.d.', 'gmbh': 'GmbH', 'mbh': 'mbH', 'ag': 'AG', 'kg': 'KG', 'ohg': 'OHG', 'ltd': 'Ltd',
    'ltd.': 'Ltd.', 'llc': 'LLC', 'plc': 'PLC', 'inc': 'Inc', 'inc.': 'Inc.', 's.r.l.': 'S.r.l.', 'srl': 'Srl', 's.p.a.': 'S.p.A.', 'spa': 'SpA',
    'kft.': 'Kft.', 'kft': 'Kft', 'zrt.': 'Zrt.', 'zrt': 'Zrt', 'bt.': 'Bt.', 's.a.': 'S.A.', 'b.v.': 'B.V.', 'n.v.': 'N.V.', 's.r.o.': 's.r.o.',
    'a.s.': 'a.s.', 'co.': 'Co.', 'e.u.': 'e.U.', 'og': 'OG', 'sas': 'SAS', 'sarl': 'SARL', 's.a.s.': 'S.a.s.' };
  var LEGAL_END = { 'dd': 'd.d.', 'sp': 's.p.', 'kd': 'k.d.', 'dno': 'd.n.o.', 'sa': 'SA', 'bv': 'BV', 'nv': 'NV', 'as': 'AS', 'ab': 'AB', 'oy': 'Oy', 'sro': 's.r.o.' };
  var SMALL = setOf('in pri na ob v za pod nad s z k od do iz i u and of the und am an der die das di de del della la le et en');
  var STREET_LOWER = setOf('cesta ulica trg pot nabrežje nabrezje steza breg cesti ulici avenija obala put c. ul. vas naselje');
  /** "VZOREC ENERGIJA, D.O.O." → "Vzorec Energija, d.o.o."; kind 'street' keeps "cesta", "ulica" … lower case */
  function titleCase(s, kind) {
    var parts = str(s).toLowerCase().split(/(\s+)/), words = 0, wi = 0;
    parts.forEach(function (p) { if (p && !/^\s+$/.test(p)) words++; });
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]; if (!p || /^\s+$/.test(p)) continue;
      var m = /^(.*?)([,;:]*)$/.exec(p), w = m[1], trail = m[2], last = wi === words - 1, out;
      if (LEGAL_ANY[w]) out = LEGAL_ANY[w];
      else if (last && LEGAL_END[w] && wi > 0) out = LEGAL_END[w];
      else if (/^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/.test(w)) out = w.toUpperCase();
      else if (wi > 0 && (SMALL[w] || (kind === 'street' && STREET_LOWER[w]))) out = w;
      else out = w.replace(/(^|[-\/("'„«])([a-zß-ɏ])/g, function (a, b, c) { return b + c.toUpperCase(); });
      parts[i] = out + trail; wi++;
    }
    return parts.join('');
  }
  function isCaps(t) {
    var letters = t.replace(/[^A-Za-zÀ-ɏ]/g, '');
    if (letters.length < 4 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) return false;
    if (!/\s/.test(t.trim()) && letters.length <= 5) return false; // a short acronym on its own (IKEA, OMV)
    return true;
  }

  // ── mojibake: UTF-8 bytes that were read as Windows-1252 ───────────────
  var CP1252 = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030,
    0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013,
    0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
  var CP1252_REV = {};
  Object.keys(CP1252).forEach(function (b) { CP1252_REV[CP1252[b]] = +b; });
  var MOJI_RE = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†-•…‰‹›€™]/;
  var utf8Fatal = null;
  function utf8() { if (!utf8Fatal) utf8Fatal = new TextDecoder('utf-8', { fatal: true }); return utf8Fatal; }
  /** "Å¡ola" → "šola"; null when the text is not mojibake or the repair is not cleaner */
  function fixMojibake(s, depth) {
    s = str(s);
    if (!MOJI_RE.test(s)) return null;
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x100) bytes[i] = c; else if (CP1252_REV[c] != null) bytes[i] = CP1252_REV[c]; else return null;
    }
    var out; try { out = utf8().decode(bytes); } catch (e) { return null; }
    if (out === s || out.length >= s.length || out.indexOf('\uFFFD') >= 0 || /[\u0080-\u009F]/.test(out)) return null;
    if (MOJI_RE.test(out) && !depth) { var again = fixMojibake(out, 1); if (again) return again; }
    return out;
  }
  /** the reverse, for demo data and tests: what "š" looks like after a wrong decode */
  function toMojibake(s) {
    var b = new TextEncoder().encode(str(s)), out = '';
    for (var i = 0; i < b.length; i++) out += String.fromCharCode(b[i] >= 0x80 && b[i] <= 0x9F && CP1252[b[i]] ? CP1252[b[i]] : b[i]);
    return out;
  }

  // ── decoding bytes ─────────────────────────────────────────────────────
  var ENCODINGS = [['utf-8', 'UTF-8'], ['windows-1250', 'Windows-1250 (Central European)'], ['windows-1252', 'Windows-1252 (Western)'], ['iso-8859-2', 'ISO-8859-2 (Latin-2)'], ['utf-16le', 'UTF-16']];
  /** bytes → { text, encoding, bom, fallback }. Without `enc`: BOM, else strict UTF-8, else Windows-1250 (old SI/HR ERP exports). */
  function decode(bytes, enc) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var bom = '';
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bom = 'utf-8';
    else if (bytes[0] === 0xFF && bytes[1] === 0xFE) bom = 'utf-16le';
    else if (bytes[0] === 0xFE && bytes[1] === 0xFF) bom = 'utf-16be';
    var text, used = enc || bom || 'utf-8', fallback = false;
    if (!enc && !bom) {
      try { text = utf8().decode(bytes); } catch (e) { used = 'windows-1250'; fallback = true; text = new TextDecoder('windows-1250').decode(bytes); }
    } else {
      text = new TextDecoder(used).decode(bytes);
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { text: text, encoding: used, bom: !!bom, fallback: fallback };
  }
  var CP1250_EXTRA = { 'Š': 0x8A, 'Ś': 0x8C, 'Ť': 0x8D, 'Ž': 0x8E, 'Ź': 0x8F, 'š': 0x9A, 'ś': 0x9C, 'ť': 0x9D, 'ž': 0x9E, 'ź': 0x9F, 'Ł': 0xA3, 'Ą': 0xA5,
    'Ş': 0xAA, 'Ż': 0xAF, 'ł': 0xB3, 'ą': 0xB9, 'ş': 0xBA, 'Ľ': 0xBC, 'ľ': 0xBE, 'ż': 0xBF, 'Ŕ': 0xC0, 'Á': 0xC1, 'Â': 0xC2, 'Ă': 0xC3, 'Ä': 0xC4,
    'Ĺ': 0xC5, 'Ć': 0xC6, 'Ç': 0xC7, 'Č': 0xC8, 'É': 0xC9, 'Ę': 0xCA, 'Ë': 0xCB, 'Ě': 0xCC, 'Í': 0xCD, 'Î': 0xCE, 'Ď': 0xCF, 'Đ': 0xD0, 'Ń': 0xD1,
    'Ň': 0xD2, 'Ó': 0xD3, 'Ô': 0xD4, 'Ő': 0xD5, 'Ö': 0xD6, '×': 0xD7, 'Ř': 0xD8, 'Ů': 0xD9, 'Ú': 0xDA, 'Ű': 0xDB, 'Ü': 0xDC, 'Ý': 0xDD, 'Ţ': 0xDE,
    'ß': 0xDF, 'ŕ': 0xE0, 'á': 0xE1, 'â': 0xE2, 'ă': 0xE3, 'ä': 0xE4, 'ĺ': 0xE5, 'ć': 0xE6, 'ç': 0xE7, 'č': 0xE8, 'é': 0xE9, 'ę': 0xEA, 'ë': 0xEB,
    'ě': 0xEC, 'í': 0xED, 'î': 0xEE, 'ď': 0xEF, 'đ': 0xF0, 'ń': 0xF1, 'ň': 0xF2, 'ó': 0xF3, 'ô': 0xF4, 'ő': 0xF5, 'ö': 0xF6, '÷': 0xF7, 'ř': 0xF8,
    'ů': 0xF9, 'ú': 0xFA, 'ű': 0xFB, 'ü': 0xFC, 'ý': 0xFD, 'ţ': 0xFE, '€': 0x80, '„': 0x84, '–': 0x96, '—': 0x97, '\u00A0': 0xA0, '§': 0xA7, '°': 0xB0 };
  /** text → Windows-1250 bytes (for the demo supplier file); characters outside the code page become '?' */
  function encodeCp1250(s) {
    s = str(s);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); out[i] = c < 0x80 ? c : (CP1250_EXTRA[s[i]] || 0x3F); }
    return out;
  }

  // ── CSV ────────────────────────────────────────────────────────────────
  var DELIMS = [';', ',', '\t', '|'];
  /** incremental RFC 4180 parser: quotes, "" escapes, delimiters and line breaks inside quotes, CRLF/LF/CR; empty lines skipped */
  function csvJob(text, delim, maxRows) {
    var t = str(text), n = t.length, d = delim.charCodeAt(0);
    var st = { i: t.charCodeAt(0) === 0xFEFF ? 1 : 0, row: [], cell: '', q: false, started: false, line: 1, rowLine: 1 };
    var job = { done: n === 0, progress: n === 0 ? 1 : 0, rows: [], lines: [], step: step };
    function endRow() {
      st.row.push(st.cell); st.cell = ''; st.started = false;
      var row = st.row; st.row = [];
      var any = false; for (var k = 0; k < row.length; k++) if (row[k] !== '' && /\S/.test(row[k])) { any = true; break; }
      if (any) { job.rows.push(row); job.lines.push(st.rowLine); if (maxRows && job.rows.length >= maxRows) st.stop = true; }
    }
    function step(budget) {
      var i = st.i, end = Math.min(n, i + (budget || 400000));
      while (i < end) {
        if (st.stop) { i = n; st.cell = ''; st.row = []; st.q = false; break; }
        var ch = t.charCodeAt(i);
        if (st.q) {
          if (ch === 34) {
            if (t.charCodeAt(i + 1) === 34) { st.cell += '"'; i += 2; continue; }
            st.q = false; i++; continue;
          }
          var nq = t.indexOf('"', i); if (nq < 0) nq = n;
          var chunk = t.slice(i, nq);
          for (var k = chunk.indexOf('\n'); k >= 0; k = chunk.indexOf('\n', k + 1)) st.line++;
          st.cell += chunk; i = nq; continue;
        }
        if (ch === 34 && !st.started) { st.q = true; st.started = true; i++; continue; }
        if (ch === d) { st.row.push(st.cell); st.cell = ''; st.started = false; i++; continue; }
        if (ch === 10 || ch === 13) {
          endRow();
          if (ch === 13 && t.charCodeAt(i + 1) === 10) i++;
          i++; st.line++; st.rowLine = st.line; continue;
        }
        var j = i + 1;
        while (j < n) { var c2 = t.charCodeAt(j); if (c2 === d || c2 === 10 || c2 === 13 || c2 === 34) break; j++; }
        st.cell += t.slice(i, j); st.started = true; i = j;
      }
      st.i = i;
      if (i >= n && !job.done) { if (st.cell !== '' || st.row.length || st.q) endRow(); job.done = true; }
      job.progress = n ? Math.min(1, i / n) : 1;
      return job;
    }
    return job;
  }
  function parseCsv(text, delim, maxRows) { var j = csvJob(text, delim || sniffDelimiter(text), maxRows); while (!j.done) j.step(1e7); return { rows: j.rows, lines: j.lines }; }
  /** the delimiter that splits the first lines into the most consistent number of columns (ties: ; , tab |) */
  function sniffDelimiter(text) {
    var sample = str(text).slice(0, 65536), best = ';', bestScore = 0;
    DELIMS.forEach(function (d) {
      var rows = parseCsv(sample, d, 60).rows;
      if (sample.length >= 65536 && rows.length > 1) rows.pop();
      if (!rows.length) return;
      var freq = {}, mode = 0, modeN = 0;
      rows.forEach(function (r) { var k = r.length; freq[k] = (freq[k] || 0) + 1; if (freq[k] > modeN || (freq[k] === modeN && k > mode)) { mode = k; modeN = freq[k]; } });
      if (mode < 2) return;
      var score = modeN / rows.length * 100 + Math.min(mode, 60) / 10;
      if (score > bestScore + 1e-9) { best = d; bestScore = score; }
    });
    return best;
  }
  function delimName(d) { return { ';': 'semicolon', ',': 'comma', '\t': 'tab', '|': 'pipe' }[d] || d; }

  // ── header synonyms (sl / hr / en / de / it) ───────────────────────────
  function headerKey(h) { return fold(h).replace(/[^a-z0-9]+/g, ' ').trim(); }
  var HEADER_EXACT = {};
  [
    ['id', 'sifra|id|koda|code|st|stevilka|broj|oznaka|sifra kupca|sifra partnerja|sifra stranke|sifra dobavitelja|sifra dobavljaca|customer id|customer no|customer number|customer code|supplier id|supplier no|supplier code|vendor id|vendor no|partner id|partner code|account no|kupac sifra|sifra kupac|kunden nr|kundennummer|codice'],
    ['sku', 'sku|sifra artikla|sifra izdelka|sifra proizvoda|item code|item no|item number|product code|product no|article no|artikel nr|artikelnummer|kataloska stevilka|kat st|art st|sifra blaga'],
    ['name', 'naziv|ime|name|naziv partnerja|naziv kupca|naziv dobavitelja|naziv dobavljaca|naziv podjetja|naziv firme|naziv tvrtke|tvrtka|firma|podjetje|company|company name|customer|customer name|supplier name|vendor name|naziv artikla|naziv izdelka|naziv proizvoda|product name|item name|kupec|stranka|naziv stranke|naziv 1|naziv1|partner|ragione sociale|firmenname|nev'],
    ['street', 'ulica|naslov|address|street|adresa|ulica in hisna stevilka|ulica i kucni broj|ulica in st|cesta|address line 1|address 1|naslov 1|sedez|strasse|indirizzo|street address|naslov sedeza|adresa sjedista|cim'],
    ['postal', 'posta|postna stevilka|postna st|post st|p st|ptt|zip|zip code|postal code|postcode|post code|plz|postanski broj|post broj|pb|cap|irsz|iranyitoszam'],
    ['city', 'kraj|mesto|city|town|mjesto|grad|ort|stadt|citta|naselje|kraj poste|varos|localita'],
    ['country', 'drzava|country|land|zemlja|paese|nazione|country code|drzava iso|oznaka drzave|koda drzave|orszag|staat'],
    ['vat', 'davcna stevilka|davcna st|davcna|ds|id za ddv|identifikacijska stevilka za ddv|ddv stevilka|ddv st|id ddv|vat id|vat no|vat number|vat reg no|vat registration number|tax id|tax number|pdv id|pdv broj|pdv id broj|porezni broj|uid|uid nummer|ust id|ust idnr|ustidnr|partita iva|p iva|piva|adoszam|dic'],
    ['oib', 'oib|osobni identifikacijski broj'],
    ['regno', 'maticna stevilka|maticna st|maticna|ms|maticni broj|mbs|mb|registration number|registration no|company number|reg no|reg st|company reg no|firmenbuchnummer|handelsregisternummer|cegjegyzekszam'],
    ['phone', 'telefon|tel|telephone|phone|gsm|mobitel|mobilni telefon|mobilna stevilka|mobile|mob|fax|faks|telefaks|tel st|telefonska stevilka|broj telefona|phone number|mobile phone|telefono|telefonszam'],
    ['email', 'e posta|eposta|email|e mail|mail|e naslov|elektronska posta|e adresa|email address|e mail address|e posta za racune|email za racune|e posta za e racune'],
    ['website', 'spletna stran|splet|web|website|www|url|homepage|web stranica|web stran|internetna stran|web site|sito web|honlap'],
    ['iban', 'iban|trr|transakcijski racun|bancni racun|racun|ziro racun|bank account|account number|iban stevilka|broj racuna|tekuci racun|bankkonto|konto iban|iban broj'],
    ['bic', 'bic|swift|bic swift|swift bic|swift code|bic koda|bic code'],
    ['ean', 'ean|ean13|ean 13|ean koda|ean code|crtna koda|crtna|barkod|bar kod|barcode|bar code|gtin|upc|koda ean'],
    ['price', 'cena|cijena|price|mpc|vpc|cena brez ddv|cena z ddv|cijena bez pdv|cijena bez pdv a|cijena s pdv|cijena s pdv om|prodajna cena|nabavna cena|unit price|net price|neto cena|list price|preis|prezzo|cena eur|cena za enoto|veleprodajna cena|maloprodajna cena|cena brez ddv eur|ar'],
    ['vatrate', 'ddv|stopnja ddv|davcna stopnja|ddv stopnja|pdv|stopa pdv|pdv stopa|porezna stopa|vat rate|tax rate|mwst|ust|iva|ddv procent|afa'],
    ['unit', 'em|enota|enota mere|merska enota|jm|jedinica mjere|jed mj|jedinica|unit|uom|unit of measure|me|mera|einheit|unita di misura|mertekegyseg'],
    ['date', 'datum|date|datum vnosa|datum kreiranja|datum odprtja|datum spremembe|datum zadnje spremembe|created|created at|created on|date created|updated|datum unosa|datum otvaranja|datum registracije|datum vpisa|valid from|velja od|datum ustanovitve'],
    ['number', 'placilni rok|rok placila|rok placanja|valuta placila|dni|payment terms|payment days|kreditni limit|limit|credit limit|kreditni limit eur|popust|rabat|discount|kolicina|kolicina na zalogi|zaloga|stock|quantity|qty|kol|teza|weight|masa|minimalna kolicina|zaposleni|st zaposlenih|employees'],
    ['text', 'kontaktna oseba|kontakt|contact|contact person|kontakt osoba|opomba|opombe|note|notes|komentar|napomena|skupina|grupa|group|kategorija|category|dobavitelj|dobavljac|proizvajalec|proizvodac|manufacturer|brand|znamka|blagovna znamka|referent|komercialist|prodajalec|regija|region|tip|vrsta|status|aktiven|segment|dejavnost|djelatnost|industry|odgovorna oseba|direktor|opis|description|ime in priimek|ime i prezime']
  ].forEach(function (x) { x[1].split('|').forEach(function (k) { HEADER_EXACT[k] = x[0]; }); });
  var HEADER_CONTAINS = [
    [/\be ?(posta|poste|mail|naslov|adresa)\b|\bemail\b|\bmail\b/, 'email'],
    [/\biban\b|\btrr\b|transakcijsk|ziro racun|bancni racun|bank account|tekuci racun/, 'iban'],
    [/\bbic\b|\bswift\b/, 'bic'],
    [/\bean\b|\bgtin\b|crtn|barkod|bar ?code|\bupc\b/, 'ean'],
    [/\boib\b/, 'oib'],
    [/(stopnja|\bstopa\b|\brate\b|procent|\bsatz\b).*(ddv|pdv|vat|davek|davcn|porez|tax|mwst)|(ddv|pdv|vat|davek|davcn|porez|tax|mwst).*(stopnja|\bstopa\b|\brate\b|procent|\bsatz\b)/, 'vatrate'],
    [/id za ddv|ddv st|vat (id|no|num|reg)|pdv (id|broj)|davcn|\buid\b|ust ?id|partita iva|porezni broj|tax (id|num)/, 'vat'],
    [/maticn|registration|\breg ?(no|st)\b|company (no|number)/, 'regno'],
    [/telefon|\btel\b|phone|\bgsm\b|mobitel|mobile|\bfax\b|faks/, 'phone'],
    [/spletn|website|\bweb\b|\bwww\b|\burl\b|homepage/, 'website'],
    [/postn|postansk|\bzip\b|\bplz\b|postal|post ?code|\bptt\b/, 'postal'],
    [/drzav|country/, 'country'],
    [/\bkraj\b|\bmesto\b|\bmjesto\b|\bcity\b|\btown\b|naselje/, 'city'],
    [/sifra artikla|sifra izdelka|\bsku\b|item (code|no)|product code|katalo/, 'sku'],
    [/\bcena\b|cijena|price|\bmpc\b|\bvpc\b|preis|prezzo/, 'price'],
    [/\benota\b|jedinica|\buom\b|\bunit\b/, 'unit'],
    [/datum|\bdate\b|created|updated/, 'date'],
    [/ulica|naslov|address|adresa|street|\bcesta\b/, 'street'],
    [/kontakt|contact|oseba|osoba|opomb|napomen|komentar|\bnote/, 'text'],
    [/naziv|\bname\b|company|podjetj|tvrtk|firma|\bime\b/, 'name'],
    [/sifra|\bkoda\b|\bcode\b|\bid\b|oznaka/, 'id'],
    [/placil|placan|\brok\b|limit|popust|rabat|discount|kolicin|quantity|zaloga|stock|\bdni\b|days/, 'number']
  ];
  var CREATED_RE = /vnos|kreir|ustvar|created|odprt|otvar|registr|vpis|unos|entry|ustanov|opened|since|od kdaj/;
  /** the role a header names, or null */
  function headerRole(h) {
    var k = headerKey(h);
    if (!k) return null;
    if (HEADER_EXACT[k]) return HEADER_EXACT[k];
    for (var i = 0; i < HEADER_CONTAINS.length; i++) if (HEADER_CONTAINS[i][0].test(k)) return HEADER_CONTAINS[i][1];
    return null;
  }

  // ── roles and dataset types ────────────────────────────────────────────
  var ROLES = [
    ['id', 'ID / code', 1], ['name', 'Name', 1], ['vat', 'VAT ID', 1], ['regno', 'Company registration no.', 1], ['oib', 'OIB', 1],
    ['street', 'Street', 1], ['postal', 'Postal code', 1], ['city', 'City', 1], ['country', 'Country', 1], ['phone', 'Phone', 0],
    ['email', 'Email', 0], ['website', 'Website', 0], ['iban', 'IBAN', 0], ['bic', 'BIC', 0], ['ean', 'EAN / GTIN', 0], ['sku', 'SKU', 1],
    ['price', 'Price', 0], ['vatrate', 'VAT rate', 1], ['unit', 'Unit', 1], ['date', 'Date', 0], ['number', 'Number', 0], ['text', 'Text', 0],
    ['ignore', 'Ignore', 0]
  ].map(function (x) { return { id: x[0], name: x[1], unique: !!x[2] }; });
  var ROLE = {};
  ROLES.forEach(function (r) { ROLE[r.id] = r; });
  var TYPES = [{ id: 'customers', name: 'Customers', one: 'customer', many: 'customers' }, { id: 'suppliers', name: 'Suppliers', one: 'supplier', many: 'suppliers' }, { id: 'products', name: 'Products', one: 'product', many: 'products' }];
  var TYPE = {};
  TYPES.forEach(function (t) { TYPE[t.id] = t; });
  var DEFAULT_REQ = {
    customers: { required: ['name', 'street', 'postal', 'city', 'country'], recommended: ['vat', 'email', 'phone'] },
    suppliers: { required: ['name', 'street', 'postal', 'city', 'country'], recommended: ['vat', 'email', 'phone'] },
    products: { required: ['sku', 'name', 'unit', 'price'], recommended: ['ean'] }
  };
  var VAT_RATES = { SI: [22, 9.5, 5], HR: [25, 13, 5] };

  // ── countries ──────────────────────────────────────────────────────────
  var ISO2 = setOf('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW');
  var COUNTRY_MAP = {};
  [
    'SI|svn|slo|slovenija|slovenia|republika slovenija|r slovenija|rs slovenija|slowenien|slovenie|szlovenia',
    'HR|hrv|cro|hrvatska|croatia|republika hrvatska|r hrvatska|kroatien|croazia|horvatorszag|hrvaska|croatie',
    'AT|aut|austria|avstrija|osterreich|oesterreich|austrija|ausztria|autriche|republik osterreich',
    'IT|ita|italia|italy|italija|italien|olaszorszag|italie',
    'DE|deu|ger|germany|deutschland|nemcija|njemacka|nemetorszag|germania|allemagne|zr nemcija|bundesrepublik deutschland',
    'HU|hun|hungary|madzarska|madjarska|madarska|magyarorszag|ungarn|ungheria|hongrie',
    'RS|srb|serbia|srbija|serbien|szerbia',
    'BA|bih|bosna in hercegovina|bosna i hercegovina|bosnia and herzegovina|bosnia & herzegovina|bosnia|bosna|bosnien und herzegowina',
    'ME|mne|montenegro|crna gora',
    'MK|mkd|north macedonia|macedonia|makedonija|severna makedonija|sjeverna makedonija|nordmazedonien',
    'CZ|cze|czechia|czech republic|ceska|ceska republika|tschechien|csehorszag|cesko|repubblica ceca',
    'SK|svk|slovakia|slovaska|slovacka|slowakei|szlovakia|slovensko',
    'PL|pol|poland|poljska|polen|polonia|lengyelorszag|polska',
    'FR|fra|france|francija|francuska|frankreich|francia',
    'ES|esp|spain|spanija|spanjolska|spanien|espana|spagna',
    'NL|nld|netherlands|the netherlands|nizozemska|holland|niederlande|paesi bassi|nederland',
    'BE|bel|belgium|belgija|belgien|belgique|belgio',
    'LU|lux|luxembourg|luksemburg|luxemburg',
    'CH|che|sui|switzerland|svica|svicarska|schweiz|suisse|svizzera',
    'GB|gbr|uk|united kingdom|great britain|velika britanija|zdruzeno kraljestvo|ujedinjeno kraljevstvo|england|anglija|engleska|grossbritannien',
    'IE|irl|ireland|irska|irland',
    'BG|bgr|bulgaria|bolgarija|bugarska|bulgarien',
    'RO|rou|romania|romunija|rumunjska|rumanien',
    'GR|grc|greece|grcija|grcka|griechenland|el|grecia',
    'PT|prt|portugal|portugalska|portugalija',
    'DK|dnk|denmark|danska|danemark|danmark',
    'SE|swe|sweden|svedska|schweden|sverige',
    'FI|fin|finland|finska|finnland|suomi',
    'NO|nor|norway|norveska|norwegen|norge',
    'LI|lie|liechtenstein|lihtenstajn',
    'EE|est|estonia|estonija|estland',
    'LV|lva|latvia|latvija|lettland',
    'LT|ltu|lithuania|litva|litauen',
    'MT|mlt|malta',
    'CY|cyp|cyprus|ciper|cipar|zypern',
    'US|usa|united states|united states of america|zda|sad|amerika|vereinigte staaten',
    'TR|tur|turkey|turkiye|turcija|turska|turkei',
    'UA|ukr|ukraine|ukrajina',
    'AL|alb|albania|albanija',
    'XK|xkx|kosovo',
    'CN|chn|china|kitajska|kina',
    'JP|jpn|japan|japonska',
    'CA|can|canada|kanada',
    'RU|rus|russia|rusija|russland|ruska federacija',
    'IS|isl|iceland|islandija|island',
    'MC|mco|monaco|monako',
    'SM|smr|san marino',
    'AD|and|andorra',
    'BY|blr|belarus|belorusija|bjelorusija',
    'MD|mda|moldova|moldavija'
  ].forEach(function (line) { var p = line.split('|'); p.slice(1).forEach(function (k) { COUNTRY_MAP[k] = p[0]; }); });
  /** "Slovenija", "SLO", "svn", "si" → "SI"; null when unknown */
  function countryOf(t) {
    var s = str(t).trim(); if (!s) return null;
    if (s.length === 2) { var up = s.toUpperCase(); if (ISO2[up]) return up; }
    var k = fold(s).replace(/\./g, '').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return COUNTRY_MAP[k] || null;
  }

  // ── VAT IDs, OIB ───────────────────────────────────────────────────────
  var VAT_RE = {
    AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/, CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/, DK: /^DK\d{8}$/,
    EE: /^EE\d{9}$/, EL: /^EL\d{9}$/, ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^FI\d{8}$/, FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/, HR: /^HR\d{11}$/,
    HU: /^HU\d{8}$/, IE: /^IE(\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/, IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/,
    LV: /^LV\d{11}$/, MT: /^MT\d{8}$/, NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/, RO: /^RO\d{2,10}$/, SE: /^SE\d{10}01$/,
    SI: /^SI[1-9]\d{7}$/, SK: /^SK\d{10}$/, GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/, XI: /^XI(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
    CH: /^CHE\d{9}(MWST|TVA|IVA)?$/, NO: /^NO\d{9}(MVA)?$/, RS: /^RS\d{9}$/, BA: /^BA\d{12}$/, ME: /^ME\d{8}$/, MK: /^MK\d{13}$/
  };
  var VAT_DESC = { AT: 'ATU and 8 digits', BE: 'BE and 10 digits', BG: 'BG and 9 or 10 digits', CY: 'CY, 8 digits and a letter', CZ: 'CZ and 8 to 10 digits',
    DE: 'DE and 9 digits', DK: 'DK and 8 digits', EE: 'EE and 9 digits', EL: 'EL and 9 digits', ES: 'ES and 9 characters', FI: 'FI and 8 digits',
    FR: 'FR, 2 characters and 9 digits', HR: 'HR and the 11-digit OIB', HU: 'HU and 8 digits', IE: 'IE and 8 or 9 characters', IT: 'IT and 11 digits',
    LT: 'LT and 9 or 12 digits', LU: 'LU and 8 digits', LV: 'LV and 11 digits', MT: 'MT and 8 digits', NL: 'NL, 9 digits, B and 2 digits',
    PL: 'PL and 10 digits', PT: 'PT and 9 digits', RO: 'RO and 2 to 10 digits', SE: 'SE and 12 digits ending in 01', SI: 'SI and 8 digits, not starting with 0',
    SK: 'SK and 10 digits', GB: 'GB and 9 or 12 digits', XI: 'XI and 9 or 12 digits', CH: 'CHE and 9 digits', NO: 'NO and 9 digits', RS: 'RS and 9 digits',
    BA: 'BA and 12 digits', ME: 'ME and 8 digits', MK: 'MK and 13 digits' };
  /** Slovene tax number: 8 digits, first not 0; weights 8…2, r = sum mod 11, check = 11 − r (10 → 0, r = 0 → invalid) */
  function siTaxCheckDigit(d7) {
    var s = 0; for (var i = 0; i < 7; i++) s += (+d7[i]) * (8 - i);
    var r = s % 11; if (r === 0) return -1;
    var c = 11 - r; return c === 10 ? 0 : c;
  }
  function siTaxOk(d) { if (!/^[1-9]\d{7}$/.test(str(d))) return false; var c = siTaxCheckDigit(d.slice(0, 7)); return c >= 0 && c === +d[7]; }
  /** Croatian OIB: ISO 7064 MOD 11,10 */
  function oibCheckDigit(d10) {
    var a = 10;
    for (var i = 0; i < 10; i++) { a = (a + (+d10[i])) % 10; if (a === 0) a = 10; a = (a * 2) % 11; }
    var c = 11 - a; return c === 10 ? 0 : c;
  }
  function oibOk(d) { return /^\d{11}$/.test(str(d)) && oibCheckDigit(d.slice(0, 10)) === +d[10]; }
  /** VAT ID → { ok, cc (VAT prefix), country (ISO), norm, canon, checked } or { err: 'format'|'checksum'|'prefix', cc } or { skip } */
  function vatCheck(t, rowCC) {
    var s = str(t).toUpperCase().replace(/[\s.\-\/]/g, ''), cc, full, prefixed = /^[A-Z]{2}/.test(s);
    if (prefixed) {
      cc = s.slice(0, 2); full = s;
      if (cc === 'GR') return { err: 'format', cc: 'EL', country: 'GR', greek: true };
      if (!VAT_RE[cc]) return { err: 'prefix', cc: cc };
    } else {
      cc = rowCC === 'GR' ? 'EL' : rowCC;
      if (!cc || !VAT_RE[cc]) return { skip: true };
      full = cc + s;
    }
    var country = cc === 'EL' ? 'GR' : cc === 'XI' ? 'GB' : cc;
    if (!VAT_RE[cc].test(full)) return { err: 'format', cc: cc, country: country, prefixed: prefixed };
    if (cc === 'SI' && !siTaxOk(full.slice(2))) return { err: 'checksum', cc: cc, country: country, norm: full };
    if (cc === 'HR' && !oibOk(full.slice(2))) return { err: 'checksum', cc: cc, country: country, norm: full };
    return { ok: true, cc: cc, country: country, norm: full, canon: prefixed ? full : s, checked: cc === 'SI' || cc === 'HR' };
  }

  // ── IBAN, BIC ──────────────────────────────────────────────────────────
  var IBAN_LEN = { SI: 19, HR: 21, AT: 20, DE: 22, IT: 27, HU: 28, CZ: 24, SK: 24, PL: 28, FR: 27, ES: 24, NL: 18, BE: 16, LU: 20, CH: 21, GB: 22,
    IE: 22, RS: 22, BA: 20, ME: 22, MK: 19, BG: 22, RO: 24, GR: 27, PT: 25, DK: 18, SE: 24, FI: 18, NO: 15, LI: 21, EE: 20, LV: 21, LT: 20, MT: 31,
    CY: 28, AD: 24, AL: 28, IS: 26, MC: 27, SM: 27, TR: 26, XK: 20, GI: 23, FO: 18, GL: 18, VA: 22, UA: 29, MD: 24, GE: 22, IL: 23, AE: 23, SA: 24 };
  function mod97(s) {
    var r = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i), v = c >= 65 ? c - 55 : c - 48; r = v > 9 ? (r * 100 + v) % 97 : (r * 10 + v) % 97; }
    return r;
  }
  function ibanMod(s) { return mod97(s.slice(4) + s.slice(0, 4)); }
  function ibanCheckDigits(cc, bban) { return pad2(98 - mod97(bban + cc + '00')); }
  /** → { ok, cc, norm } | { local, fix, cc } | { err: 'chars'|'country'|'length'|'checksum'|'si56', cc, len, n } */
  function ibanCheck(t, rowCC) {
    var s = str(t).toUpperCase().replace(/^IBAN[:\s]*/, '').replace(/[\s\-.]/g, '');
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) {
      if (rowCC === 'SI' && /^\d{15}$/.test(s)) {
        var cd = ibanCheckDigits('SI', s);
        return cd === '56' ? { local: true, fix: 'SI56' + s, cc: 'SI' } : { err: 'si56', cc: 'SI' };
      }
      if (rowCC === 'HR' && /^\d{17}$/.test(s)) return { local: true, fix: 'HR' + ibanCheckDigits('HR', s) + s, cc: 'HR' };
      return { err: 'chars' };
    }
    var cc = s.slice(0, 2), len = IBAN_LEN[cc];
    if (!len) return { err: 'country', cc: cc };
    if (s.length !== len) return { err: 'length', cc: cc, len: len, n: s.length };
    if (ibanMod(s) !== 1) return { err: 'checksum', cc: cc };
    if (cc === 'SI' && s.slice(2, 4) !== '56') return { err: 'si56', cc: cc };
    return { ok: true, cc: cc, norm: s };
  }
  function bicCheck(t) {
    var s = str(t).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) || !ISO2[s.slice(4, 6)]) return { err: true };
    return { ok: true, norm: s, cc: s.slice(4, 6) };
  }

  // ── e-mail ─────────────────────────────────────────────────────────────
  var EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~À-ɏ-]+(\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~À-ɏ-]+)*$/;
  var EMAIL_DOMAIN = /^([a-z0-9À-ɏ]([a-z0-9À-ɏ-]{0,61}[a-z0-9À-ɏ])?\.)+[a-zÀ-ɏ]{2,24}$/;
  var EMAIL_TYPO = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com',
    'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.si': 'gmail.com',
    'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'yahooo.com': 'yahoo.com',
    'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com',
    'siol.ne': 'siol.net', 'siol.nett': 'siol.net', 'siol.met': 'siol.net', 'siol.nte': 'siol.net', 't-2.nett': 't-2.net', 't-2.ne': 't-2.net',
    't2.net': 't-2.net', 'amis.nett': 'amis.net', 'amis.ne': 'amis.net', 'icloud.con': 'icloud.com', 'gmx.nett': 'gmx.net', 'gmx.ne': 'gmx.net' };
  var TLD_TYPO = { 'con': 'com', 'cmo': 'com', 'comm': 'com', 'coom': 'com', 'cpm': 'com', 'vom': 'com', 'xom': 'com', 'nett': 'net', 'ner': 'net',
    'nte': 'net', 'ogr': 'org', 'orgg': 'org', 'sii': 'si', 'hrr': 'hr' };
  function emailTypo(domain) {
    if (EMAIL_TYPO[domain]) return EMAIL_TYPO[domain];
    var i = domain.lastIndexOf('.'), tld = domain.slice(i + 1);
    return TLD_TYPO[tld] ? domain.slice(0, i + 1) + TLD_TYPO[tld] : null;
  }
  function emailSyntax(c) {
    var at = c.split('@');
    if (at.length === 1) return 'noat';
    if (at.length > 2) return 'multiat';
    if (!at[0] || !EMAIL_LOCAL.test(at[0])) return 'local';
    if (!EMAIL_DOMAIN.test(at[1].toLowerCase())) return 'domain';
    return '';
  }
  /** → { ok, fix?, typo? } | { err } | { multi: n, bad } */
  function emailCheck(raw) {
    var s = str(raw).trim();
    var parts = s.split(/\s*[;,]\s*|\s+(?=[^\s@]+@)/).filter(function (p) { return p; });
    if (parts.filter(function (p) { return p.indexOf('@') >= 0; }).length >= 2) {
      return { multi: parts.length, bad: parts.some(function (p) { return !!emailSyntax(p.replace(/^mailto:/i, '').replace(/^[<"'(]+|[>"')]+$/g, '')); }) };
    }
    var c = s.replace(/^mailto:/i, '').replace(/^[<"'(]+|[>"')]+$/g, '').replace(/[.,;:]+$/, '').replace(/\s+/g, '');
    var err = emailSyntax(c);
    if (err) return { err: err };
    var at = c.lastIndexOf('@'), domain = c.slice(at + 1).toLowerCase(), fixed = emailTypo(domain);
    if (fixed) return { ok: true, typo: fixed, fix: c.slice(0, at + 1) + fixed };
    if (c !== s) return { ok: true, fix: c };
    return { ok: true };
  }
  var WEB_RE = /^(https?:\/\/)?(www\.)?([a-z0-9À-ɏ]([a-z0-9À-ɏ-]*[a-z0-9À-ɏ])?\.)+[a-z]{2,24}(:\d{2,5})?(\/\S*)?$/i;

  // ── phone numbers → E.164 ──────────────────────────────────────────────
  var CALLING = { SI: ['386', '0'], HR: ['385', '0'], AT: ['43', '0'], DE: ['49', '0'], IT: ['39', ''], HU: ['36', '06'], CZ: ['420', ''], SK: ['421', '0'],
    PL: ['48', ''], RS: ['381', '0'], BA: ['387', '0'], ME: ['382', '0'], MK: ['389', '0'], CH: ['41', '0'], FR: ['33', '0'], NL: ['31', '0'],
    BE: ['32', '0'], GB: ['44', '0'], ES: ['34', ''], LU: ['352', ''], DK: ['45', ''], SE: ['46', '0'], FI: ['358', '0'], NO: ['47', ''],
    IE: ['353', '0'], PT: ['351', ''], BG: ['359', '0'], RO: ['40', '0'], GR: ['30', ''], LI: ['423', ''] };
  /* Non-geographic numbers. Slovenia (AKOS, Splošni akt o načrtu oštevilčenja): 080 freephone and 089/090 premium-rate numbers
   * have 6 digits after the country code ("080 12 34" → +386 80 1234), besides the usual 8. Croatia (HAKOM, Pravilnik o
   * numeriranju): 0800 freephone, 060 shared-cost and 061/064/069 premium-rate numbers, usually 6 digits after the prefix; 0800
   * also occurs with 4. They are valid, but are not reachable from abroad, so they are never rewritten to +386/+385. */
  var SI_SPECIAL = /^(80|89|90)\d{4}(\d{2})?$/, HR_SPECIAL = /^(800\d{4,6}|6[0149]\d{5,6})$/;
  function specialKind(cc, nsn) {
    if (cc === 'SI' && SI_SPECIAL.test(nsn)) return nsn.slice(0, 2) === '80' ? 'free' : 'premium';
    if (cc === 'HR' && HR_SPECIAL.test(nsn)) return nsn.slice(0, 3) === '800' ? 'free' : nsn.slice(0, 2) === '60' ? 'shared' : 'premium';
    return '';
  }
  /** → { ok, e164, ext, special? } | { err: 'letters'|'short'|'long'|'si'|'hr' } | { multi } */
  function phoneCheck(t, cc) {
    var raw = str(t).trim();
    var parts = raw.split(/\s*[;,]\s*|\s+\/\s+|\s+(?:ali|ili|or|in|und)\s+/i).filter(function (p) { return p.replace(/\D/g, '').length >= 6; });
    if (parts.length >= 2) return { multi: parts.length };
    var s = raw.replace(/\s*(?:int\.?|ext\.?|lok\.?|interna|kl\.?|x)\s*\d{1,5}$/i, ''), ext = s !== raw;
    if (/[A-Za-z]/.test(s)) return { err: 'letters' };
    s = s.replace(/\(\s*0\s*\)/g, '');
    var plus = /^\+/.test(s), d = s.replace(/\D/g, ''), intl = null, nsn;
    if (!d) return { err: 'short' };
    if (plus) intl = d;
    else if (d.slice(0, 2) === '00') intl = d.slice(2);
    else if (/^38[56]/.test(d) && d.length >= 11 && d.length <= 12) intl = d;
    if (intl != null) {
      if (intl.slice(0, 3) === '386') { nsn = intl.slice(3).replace(/^0/, ''); if (specialKind('SI', nsn)) return { ok: true, e164: '+386' + nsn, ext: ext, special: specialKind('SI', nsn) }; return nsn.length === 8 ? { ok: true, e164: '+386' + nsn, ext: ext } : { err: 'si', n: nsn.length }; }
      if (intl.slice(0, 3) === '385') { nsn = intl.slice(3).replace(/^0/, ''); if (specialKind('HR', nsn)) return { ok: true, e164: '+385' + nsn, ext: ext, special: specialKind('HR', nsn) }; return nsn.length >= 8 && nsn.length <= 9 ? { ok: true, e164: '+385' + nsn, ext: ext } : { err: 'hr', n: nsn.length }; }
      if (intl.length < 7) return { err: 'short' };
      if (intl.length > 15) return { err: 'long' };
      return { ok: true, e164: '+' + intl, ext: ext };
    }
    if (cc === 'SI') {
      if (d[0] === '0' && specialKind('SI', d.slice(1))) return { ok: true, e164: '+386' + d.slice(1), ext: ext, special: specialKind('SI', d.slice(1)) };
      if (d[0] === '0') nsn = d.slice(1); else if (d.length === 8 && /^[1-7]/.test(d)) nsn = d; else return { err: d.length < 8 ? 'short' : 'si', n: d.length };
      return nsn.length === 8 ? { ok: true, e164: '+386' + nsn, ext: ext } : { err: nsn.length < 8 ? 'short' : 'si', n: nsn.length };
    }
    if (cc === 'HR') {
      nsn = d[0] === '0' ? d.slice(1) : d;
      if (d[0] === '0' && specialKind('HR', nsn)) return { ok: true, e164: '+385' + nsn, ext: ext, special: specialKind('HR', nsn) };
      return nsn.length >= 8 && nsn.length <= 9 ? { ok: true, e164: '+385' + nsn, ext: ext } : { err: nsn.length < 8 ? 'short' : 'hr', n: nsn.length };
    }
    var cal = CALLING[cc];
    if (!cal) return d.length < 6 ? { err: 'short' } : d.length > 13 ? { err: 'long' } : { ok: true, e164: null, ext: ext };
    nsn = cal[1] && d.indexOf(cal[1]) === 0 ? d.slice(cal[1].length) : d;
    if (nsn.length < 5) return { err: 'short' };
    if ((cal[0] + nsn).length > 15) return { err: 'long' };
    return { ok: true, e164: '+' + cal[0] + nsn, ext: ext };
  }

  // ── postal codes ───────────────────────────────────────────────────────
  var POSTAL = {
    SI: [/^[1-9]\d{3}$/, '4 digits'], HR: [/^[1-5]\d{4}$/, '5 digits'], AT: [/^[1-9]\d{3}$/, '4 digits'], DE: [/^\d{5}$/, '5 digits', 5],
    IT: [/^\d{5}$/, '5 digits', 5], FR: [/^\d{5}$/, '5 digits', 5], ES: [/^\d{5}$/, '5 digits', 5], FI: [/^\d{5}$/, '5 digits', 5],
    HU: [/^[1-9]\d{3}$/, '4 digits'], CZ: [/^\d{3} ?\d{2}$/, '5 digits (123 45)'], SK: [/^\d{3} ?\d{2}$/, '5 digits (123 45)'],
    PL: [/^\d{2}-\d{3}$/, 'the form 12-345'], NL: [/^\d{4} ?[A-Z]{2}$/i, '4 digits and 2 letters'], BE: [/^\d{4}$/, '4 digits'],
    LU: [/^\d{4}$/, '4 digits'], CH: [/^\d{4}$/, '4 digits'], LI: [/^\d{4}$/, '4 digits'], RS: [/^\d{5}$/, '5 digits'], BA: [/^\d{5}$/, '5 digits'],
    ME: [/^\d{5}$/, '5 digits'], MK: [/^\d{4}$/, '4 digits'], BG: [/^\d{4}$/, '4 digits'], RO: [/^\d{6}$/, '6 digits'], GR: [/^\d{3} ?\d{2}$/, '5 digits'],
    PT: [/^\d{4}-\d{3}$/, 'the form 1234-567'], DK: [/^\d{4}$/, '4 digits'], SE: [/^\d{3} ?\d{2}$/, '5 digits'], NO: [/^\d{4}$/, '4 digits'],
    EE: [/^\d{5}$/, '5 digits'], LV: [/^\d{4}$/, '4 digits'], LT: [/^\d{5}$/, '5 digits']
  };
  var POST_TXT = {
    SI: '1000 Ljubljana;1210 Ljubljana - Šentvid;1211 Ljubljana - Šmartno;1215 Medvode;1218 Komenda;1230 Domžale;1234 Mengeš;1235 Radomlje;1236 Trzin;1240 Kamnik;1251 Moravče;1260 Ljubljana - Polje;1270 Litija;1290 Grosuplje;1291 Škofljica;1292 Ig;1295 Ivančna Gorica;1310 Ribnica;1330 Kočevje;1351 Brezovica pri Ljubljani;1355 Polhov Gradec;1360 Vrhnika;1370 Logatec;1380 Cerknica;1410 Zagorje ob Savi;1420 Trbovlje;1430 Hrastnik;2000 Maribor;2204 Miklavž na Dravskem polju;2230 Lenart v Slovenskih goricah;2250 Ptuj;2270 Ormož;2310 Slovenska Bistrica;2311 Hoče;2320 Poljčane;2325 Kidričevo;2342 Ruše;2360 Radlje ob Dravi;2370 Dravograd;2380 Slovenj Gradec;2390 Ravne na Koroškem;2392 Mežica;3000 Celje;3210 Slovenske Konjice;3220 Štore;3230 Šentjur;3240 Šmarje pri Jelšah;3250 Rogaška Slatina;3252 Rogatec;3270 Laško;3272 Rimske Toplice;3310 Žalec;3311 Šempeter v Savinjski dolini;3320 Velenje;3325 Šoštanj;3330 Mozirje;4000 Kranj;4202 Naklo;4208 Šenčur;4220 Škofja Loka;4226 Žiri;4240 Radovljica;4248 Lesce;4260 Bled;4270 Jesenice;4280 Kranjska Gora;4290 Tržič;5000 Nova Gorica;5220 Tolmin;5222 Kobarid;5230 Bovec;5250 Solkan;5270 Ajdovščina;5280 Idrija;5290 Šempeter pri Gorici;6000 Koper|Koper - Capodistria|Capodistria;6210 Sežana;6230 Postojna;6250 Ilirska Bistrica;6257 Pivka;6280 Ankaran|Ankaran - Ancarano|Ancarano;6310 Izola|Izola - Isola|Isola;6320 Portorož|Portorož - Portorose|Portorose;6330 Piran|Piran - Pirano|Pirano;8000 Novo mesto;8210 Trebnje;8233 Mirna;8250 Brežice;8270 Krško;8290 Sevnica;8310 Šentjernej;8330 Metlika;8340 Črnomelj;9000 Murska Sobota;9220 Lendava|Lendava - Lendva|Lendva;9231 Beltinci;9240 Ljutomer;9250 Gornja Radgona;9252 Radenci',
    HR: '10000 Zagreb;10290 Zaprešić;10360 Sesvete;10410 Velika Gorica;10430 Samobor;20000 Dubrovnik;20340 Ploče;21000 Split;21210 Solin;21220 Trogir;21230 Sinj;21300 Makarska;22000 Šibenik;22300 Knin;23000 Zadar;23210 Biograd na Moru;31000 Osijek;32000 Vukovar;32100 Vinkovci;33000 Virovitica;34000 Požega;35000 Slavonski Brod;35400 Nova Gradiška;40000 Čakovec;42000 Varaždin;43000 Bjelovar;44000 Sisak;44320 Kutina;47000 Karlovac;47300 Ogulin;48000 Koprivnica;49000 Krapina;49210 Zabok;51000 Rijeka;51260 Crikvenica;51410 Opatija;51500 Krk;52000 Pazin;52100 Pula|Pula - Pola|Pola;52210 Rovinj|Rovinj - Rovigno|Rovigno;52440 Poreč|Poreč - Parenzo|Parenzo;52470 Umag|Umag - Umago|Umago;53000 Gospić'
  };
  function cityKey(s) { return fold(s).replace(/[-–,.\/()]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function readPost(txt, into) {
    txt.split(';').forEach(function (e) {
      var sp = e.indexOf(' '), code = e.slice(0, sp), names = e.slice(sp + 1).split('|'), o = into[code];
      if (!o) { into[code] = { name: names[0], names: names.slice() }; return; }
      names.forEach(function (n) { if (!o.names.some(function (x) { return cityKey(x) === cityKey(n); })) o.names.push(n); });
    });
  }
  // POST_MAIN: the main post offices above (the demo files use them); POST: the full official lists from postal-data.js when that
  // file is loaded (Pošta Slovenije and Hrvatska pošta, see its header), with the spellings above added as aliases.
  var POST_MAIN = {}, POST = {}, POST_FULL = !!(POSTAL_DATA && POSTAL_DATA.SI && POSTAL_DATA.HR);
  Object.keys(POST_TXT).forEach(function (cc) {
    POST_MAIN[cc] = {}; readPost(POST_TXT[cc], POST_MAIN[cc]);
    POST[cc] = {};
    if (POST_FULL) readPost(POSTAL_DATA[cc], POST[cc]);
    readPost(POST_TXT[cc], POST[cc]);
  });
  /** the post office for a SI/HR code, or null */
  function postOffice(cc, code) { return POST[cc] && POST[cc][code] || null; }
  function cityMatches(city, po) { var k = cityKey(city); return po.names.some(function (n) { return cityKey(n) === k; }); }
  /** → { ok, code, city (embedded), fix?, kind } | { err, desc } | { skip } */
  function postalCheck(t, cc) {
    var s = str(t).trim(), city = '', fix = null, kind = '';
    var pm = /^([A-Z]{1,2})\s?[-–]\s?(\S.*)$/i.exec(s) || /^([A-Z]{2})\s(\d.*)$/.exec(s);
    if (pm && /\d/.test(pm[2][0])) { s = pm[2]; fix = s; kind = 'prefix'; }
    var cm = /^(\d[\d\s-]*\d|\d)\s+([^\d\s].*)$/.exec(s);
    var code = cm ? cm[1].trim() : s;
    if (cm) city = cm[2].trim();
    var rule = POSTAL[cc];
    if (!rule) return { skip: true, code: code, city: city };
    if (!rule[0].test(code)) {
      if (rule[2] === 5 && /^\d{4}$/.test(code)) return { zero: true, fix: '0' + code + (city ? ' ' + city : ''), code: '0' + code, city: city };
      return { err: true, desc: rule[1], code: code };
    }
    var c0 = code.replace(/\s/g, '');
    // a code in the right form that the official list does not have (only with the full lists loaded)
    if (POST_FULL && POST[cc] && !POST[cc][c0]) return { ok: true, unknown: true, code: c0, city: city, fix: fix, kind: kind };
    return { ok: true, code: c0, city: city, fix: fix, kind: kind };
  }

  // ── barcodes ───────────────────────────────────────────────────────────
  /** GS1 mod 10: weights 3,1,3,… from the right of the digits before the check digit */
  function gtinCheckDigit(body) {
    var s = 0;
    for (var i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) s += (+body[i]) * w;
    return (10 - s % 10) % 10;
  }
  function gtinOk(d) { return /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(str(d)) && gtinCheckDigit(d.slice(0, -1)) === +d[d.length - 1]; }
  /** → { ok, digits, len } | { sci } | { err: 'chars'|'length'|'checksum', expect } */
  function eanCheck(t) {
    var s = str(t).trim().replace(/[\s-]/g, '');
    if (/^\d+([.,]\d+)?[eE]\+?\d+$/.test(s)) return { sci: true };
    if (!/^\d+$/.test(s)) return { err: 'chars' };
    if ([8, 12, 13, 14].indexOf(s.length) < 0) return { err: 'length', n: s.length, digits: s };
    var exp = gtinCheckDigit(s.slice(0, -1));
    if (exp !== +s[s.length - 1]) return { err: 'checksum', expect: exp };
    return { ok: true, digits: s, len: s.length };
  }

  // ── numbers ────────────────────────────────────────────────────────────
  var CUR_HEAD = /^(?:€|\$|eur|usd|chf|hrk|kn)\.?\s*/i, CUR_TAIL = /\s*(?:€|\$|eur|usd|chf|hrk|kn|%)\.?$/i;
  /** "1.234,56 €" → { ok, n: 1234.56, dec: ',', thou: true, sym: true, fd: 2 }; decHint decides "1.234" (1234 or 1.234) */
  function parseNumber(t, decHint) {
    var s = str(t).trim(), sym = false, neg = false;
    function sign() { if (/^[-\u2212]/.test(s)) { neg = !neg; s = s.slice(1).trim(); } else if (s[0] === '+') s = s.slice(1).trim(); }
    sign();
    var s2 = s.replace(CUR_HEAD, '').replace(CUR_TAIL, '');
    if (s2 !== s) { sym = true; s = s2.trim(); sign(); }
    s = s.replace(/[\s\u00A0\u202F']/g, '');
    if (!s || !/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false };
    var dot = s.indexOf('.') >= 0, com = s.indexOf(',') >= 0, dec = '', thou = false, n, fd = 0;
    if (dot && com) {
      dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      var th = dec === '.' ? ',' : '.', cut = s.lastIndexOf(dec), ip = s.slice(0, cut), frac = s.slice(cut + 1);
      if (!(th === '.' ? /^\d{1,3}(\.\d{3})+$/ : /^\d{1,3}(,\d{3})+$/).test(ip) || !/^\d+$/.test(frac)) return { ok: false };
      thou = true; fd = frac.length; n = +(ip.split(th).join('') + '.' + frac);
    } else if (dot || com) {
      var sep = com ? ',' : '.', parts = s.split(sep);
      if (parts.length > 2) {
        if (!/^\d{1,3}$/.test(parts[0]) || parts.slice(1).some(function (p) { return !/^\d{3}$/.test(p); })) return { ok: false };
        thou = true; n = +parts.join('');
      } else {
        if (!parts[1]) return { ok: false };
        if (parts[1].length === 3 && /^[1-9]\d{0,2}$/.test(parts[0]) && decHint && decHint !== sep) { thou = true; n = +(parts[0] + parts[1]); }
        else { dec = sep; fd = parts[1].length; n = +((parts[0] || '0') + '.' + parts[1]); }
      }
    } else n = +s;
    if (!isFinite(n)) return { ok: false };
    return { ok: true, n: neg ? -n : n, dec: dec, thou: thou, sym: sym, fd: fd };
  }
  /** a plain number for files: no thousands, the given decimal separator, the decimals as written */
  function plainNumber(n, dec, fd) {
    var s = fd ? n.toFixed(fd) : String(Math.round(n * 1e6) / 1e6);
    return dec === ',' ? s.replace('.', ',') : s;
  }

  // ── dates ──────────────────────────────────────────────────────────────
  var DATE_FAM = { iso: 'yyyy-mm-dd', dot: 'dd.mm.yyyy', dot2: 'dd.mm.yy', slash: 'dd/mm/yyyy', us: 'mm/dd/yyyy', dash: 'dd-mm-yyyy', serial: 'Excel serial number' };
  function excelSerialToIso(v) { return fromUtc(Date.UTC(1899, 11, 30) + Math.floor(v) * DAY); }
  /** → { ok, iso, fam, fmt } | { ok: false, why: 'unparsed'|'impossible' } */
  function parseDate(t, opts) {
    var s = str(t).trim().replace(/(\d)[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/, '$1'), m, y, mo, d, fam, fmt;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; fam = 'iso'; fmt = 'yyyy-mm-dd'; }
    else if ((m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?$/.exec(s))) {
      d = +m[1]; mo = +m[2]; y = +m[3]; fam = 'dot';
      fmt = /\.\s/.test(s) ? 'd. m. yyyy' : m[1].length === 2 && m[2].length === 2 ? 'dd.mm.yyyy' : 'd.m.yyyy';
    } else if ((m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2})$/.exec(s))) {
      d = +m[1]; mo = +m[2]; y = +m[3]; y += y <= ((opts && opts.pivot) || 50) ? 2000 : 1900; fam = 'dot2'; fmt = 'dd.mm.yy';
    } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
      if (+m[1] <= 12 && +m[2] > 12) { mo = +m[1]; d = +m[2]; fam = 'us'; fmt = 'mm/dd/yyyy'; } else { d = +m[1]; mo = +m[2]; fam = 'slash'; fmt = 'dd/mm/yyyy'; }
      y = +m[3];
    } else if ((m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; fam = 'dash'; fmt = 'dd-mm-yyyy'; }
    else if (opts && opts.serial && /^\d{5}(\.\d+)?$/.test(s) && +s >= 20000 && +s <= 80000) {
      var iso = excelSerialToIso(+s); return { ok: true, iso: iso, fam: 'serial', fmt: 'serial' };
    } else return { ok: false, why: 'unparsed' };
    if (!validYmd(y, mo, d)) return { ok: false, why: 'impossible' };
    return { ok: true, iso: ymd(y, mo, d), fam: fam, fmt: fmt };
  }
  function formatDate(iso, fmt) {
    var y = iso.slice(0, 4), m = iso.slice(5, 7), d = iso.slice(8, 10);
    switch (fmt) {
      case 'yyyy-mm-dd': return iso;
      case 'd.m.yyyy': return +d + '.' + +m + '.' + y;
      case 'd. m. yyyy': return +d + '. ' + +m + '. ' + y;
      case 'dd.mm.yy': return d + '.' + m + '.' + y.slice(2);
      case 'dd/mm/yyyy': return d + '/' + m + '/' + y;
      case 'mm/dd/yyyy': return m + '/' + d + '/' + y;
      case 'dd-mm-yyyy': return d + '-' + m + '-' + y;
      default: return d + '.' + m + '.' + y;
    }
  }

  // ── units ──────────────────────────────────────────────────────────────
  var UNIT_GROUP = {};
  [['pc', 'kos|kos.|kom|kom.|komad|komadi|kosov|pcs|pcs.|pc|pc.|stk|stk.|st|st.|stück|stuck|ea|each|piece|pieces'],
    ['set', 'kpl|kpl.|kompl|kompl.|komplet|set|garnitura'], ['m', 'm|m.|met|meter|metar|mtr|lm'], ['m2', 'm2|m²|qm|kvm|kv.m'],
    ['m3', 'm3|m³'], ['kg', 'kg|kg.|kgs|kilogram'], ['g', 'g|gr|gram'], ['l', 'l|lit|liter|litra|ltr|lt'], ['pair', 'par|pr|pair|pari'],
    ['pack', 'pak|pak.|pakiranje|pck|pack|zav|zav.|zavoj|pkt|paket'], ['roll', 'kolut|rola|rol|roll'], ['box', 'škatla|skatla|box|karton'],
    ['h', 'h|ura|ur|sat|hr']
  ].forEach(function (x) { x[1].split('|').forEach(function (u) { UNIT_GROUP[u] = x[0]; }); });
  function unitGroup(t) { var k = str(t).trim().toLowerCase(); return UNIT_GROUP[k] || UNIT_GROUP[fold(k)] || null; }

  // ── VAT rates ──────────────────────────────────────────────────────────
  function rateIn(n, list) { return (list || []).some(function (x) { return Math.abs(x - n) < 0.001; }); }

  // ── names and similarity (duplicates) ──────────────────────────────────
  var LEGAL_TOKENS = setOf('doo jdoo dd sp kd dno kdd gmbh mbh ag kg ohg ug ltd limited llc inc plc corp co srl srls spa sas sarl sa nv bv kft zrt nyrt bt kkt sro as oy ab aps asa ad ood eood obrt eu og');
  var FILLER = setOf('in i and und the of za na pri v u s z k od do der die das di de del della la le et en e');
  /** "VZOREC ENERGIJA, D.O.O." → ['vzorec', 'energija'] */
  function nameTokens(s) {
    var f = fold(s).replace(/\b([a-z])\.\s+(?=[a-z]\.)/g, '$1.').replace(/([a-z])\.(?=[a-z])/g, '$1');
    return f.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (t) { return t && !LEGAL_TOKENS[t] && !FILLER[t]; });
  }
  function jaro(a, b) {
    if (a === b) return a.length ? 1 : 0;
    var la = a.length, lb = b.length; if (!la || !lb) return 0;
    var win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1), ma = new Uint8Array(la), mb = new Uint8Array(lb), m = 0, i, j;
    for (i = 0; i < la; i++) {
      var lo = Math.max(0, i - win), hi = Math.min(lb - 1, i + win);
      for (j = lo; j <= hi; j++) if (!mb[j] && a.charCodeAt(i) === b.charCodeAt(j)) { ma[i] = mb[j] = 1; m++; break; }
    }
    if (!m) return 0;
    var tr = 0, k = 0;
    for (i = 0; i < la; i++) { if (!ma[i]) continue; while (!mb[k]) k++; if (a.charCodeAt(i) !== b.charCodeAt(k)) tr++; k++; }
    return (m / la + m / lb + (m - tr / 2) / m) / 3;
  }
  function jaroWinkler(a, b) {
    var j = jaro(a, b), l = 0;
    while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
    return j + l * 0.1 * (1 - j);
  }
  /** order-insensitive token similarity: tokens matched by Jaro-Winkler ≥ 0.88, weighted by length, over the longer name */
  function tokenSetSim(A, B) {
    if (!A.length || !B.length) return 0;
    var pairs = [], i, j;
    for (i = 0; i < A.length; i++) for (j = 0; j < B.length; j++) { var s = A[i] === B[j] ? 1 : jaroWinkler(A[i], B[j]); if (s >= 0.88) pairs.push([s, i, j]); }
    pairs.sort(function (x, y) { return y[0] - x[0]; });
    var ua = {}, ub = {}, got = 0, la = 0, lb = 0;
    pairs.forEach(function (p) { if (ua[p[1]] || ub[p[2]]) return; ua[p[1]] = ub[p[2]] = 1; got += p[0] * (A[p[1]].length + B[p[2]].length) / 2; });
    A.forEach(function (t) { la += t.length; }); B.forEach(function (t) { lb += t.length; });
    return got / Math.max(la, lb);
  }
  /** 1 − Levenshtein distance ÷ the longer length */
  function levSim(a, b) {
    var la = a.length, lb = b.length; if (!la || !lb) return 0;
    var prev = new Array(lb + 1), cur = new Array(lb + 1), i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      for (j = 1; j <= lb; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      var t = prev; prev = cur; cur = t;
    }
    return 1 - prev[lb] / Math.max(la, lb);
  }
  /** name similarity 0–1: the token-set similarity (Jaro-Winkler per word, any order), or the edit similarity of the joined
   * name when that is higher (catches "Termoplan" vs "Termo plan") */
  function nameSim(a, b) {
    if (!a.compact || !b.compact) return 0;
    if (a.compact === b.compact) return 1;
    var ts = tokenSetSim(a.tokens, b.tokens), la = a.compact.length, lb = b.compact.length;
    if (ts >= 0.97 || Math.min(la, lb) / Math.max(la, lb) <= ts) return ts;
    return Math.max(ts, levSim(a.compact, b.compact));
  }
  function streetKey(s) {
    return fold(s).replace(/\bc\.\s*/g, 'cesta ').replace(/\bul\.\s*/g, 'ulica ').replace(/\bstr\.\s*/g, 'strasse ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ── rules ──────────────────────────────────────────────────────────────
  var SEV_W = { error: 3, warning: 1, info: 0 };
  var MIN_PAIR = 60; // pairs scoring lower are not kept; the threshold slider starts here
  var GROUPS = [['complete', 'Missing data'], ['dup', 'Duplicates'], ['tax', 'Tax and registration IDs'], ['bank', 'Bank details'], ['contact', 'Contact details'],
    ['address', 'Addresses and countries'], ['product', 'Products'], ['number', 'Numbers, prices and dates'], ['text', 'Spaces and text']];
  // id, severity, group, 'fix' (one click for all) | 'sug' (suggestion per row) | '', title, why it matters
  var RULE_LIST = [
    ['req.nocolumn', 'error', 'complete', '', 'Required column is missing', 'The target system needs this field for every record, so every row counts as an error until the column is there. Add it to the export, mark an existing column with this role on the Columns tab, or make the field optional in Settings.'],
    ['rec.nocolumn', 'info', 'complete', '', 'Recommended column is missing', 'Not required, but useful: add it to the export if the source system has it.'],
    ['req.missing', 'error', 'complete', '', 'Required field is empty', 'An import usually rejects records without these fields. Fill them in at the source.'],
    ['rec.missing', 'warning', 'complete', '', 'Recommended field is empty', 'Records import, but invoices, reminders or reports will lack these details.'],
    ['text.placeholder', 'warning', 'complete', 'fix', 'Placeholder instead of a value', 'Values like "-", "n/a" or "0" look filled in but are not. The fix empties them so they show up as missing.'],
    ['id.dup', 'error', 'dup', '', 'Duplicate code', 'Two records with the same code cannot both be imported, and documents may point at the wrong one.'],
    ['dup.record', 'warning', 'dup', '', 'Possible duplicate record', 'The same partner or product entered twice splits its history, balances and discounts. Merge them before the migration.'],
    ['vat.dup', 'warning', 'dup', '', 'Same VAT ID on different records', 'Either branches of one company (fine) or a VAT ID copied to the wrong record (check it).'],
    ['ean.dup', 'warning', 'dup', '', 'Same barcode on several products', 'A scanner cannot tell these products apart.'],
    ['text.mojibake', 'error', 'text', 'fix', 'Broken characters from a wrong encoding', 'A file was read with the wrong code page at some point, so "š" became "Å¡". The fix restores the original letters.'],
    ['text.lost', 'error', 'text', '', 'Character lost in an earlier conversion', 'The "\uFFFD" sign replaced a letter that can no longer be recovered automatically. Correct these by hand.'],
    ['ws.trim', 'warning', 'text', 'fix', 'Spaces at the start or end', 'Invisible extra spaces make "Vzorec" and "Vzorec " different values, which breaks lookups and matching.'],
    ['ws.nbsp', 'warning', 'text', 'fix', 'Non-breaking or invisible spaces', 'Copied from web pages or Word; they look like spaces but do not match them.'],
    ['ws.newline', 'warning', 'text', 'fix', 'Line break inside a cell', 'Many import tools treat a line break as the end of the record.'],
    ['ws.control', 'warning', 'text', 'fix', 'Tab or control character', 'Invisible control characters break exports and imports.'],
    ['ws.double', 'info', 'text', 'fix', 'Double spaces', 'Harmless in print, but they hinder searching and matching.'],
    ['text.caps', 'info', 'text', 'fix', 'Written in capitals', 'Names in capitals look poor on invoices and letters. The fix keeps legal forms such as d.o.o. and GmbH right.'],
    ['vat.format', 'error', 'tax', '', 'VAT ID has the wrong format', 'Invoices with a wrong VAT ID can be rejected and reverse-charge VAT may not apply. SI and HR numbers are checked with their check digit; other countries for format only.'],
    ['vat.checksum', 'error', 'tax', '', 'VAT ID check digit is wrong', 'The number cannot exist; usually a typo. Look it up in VIES or the national register.'],
    ['vat.vies', 'warning', 'tax', '', 'VAT ID not valid in VIES', 'The European Commission\'s VIES service says this VAT ID is not registered for trade between EU countries: it was never issued, has been cancelled, or the company is not VAT-registered. Intra-EU supplies to it cannot be invoiced without VAT, and an e-invoice with it may be rejected.'],
    ['vat.country', 'warning', 'tax', '', 'VAT prefix does not match the country', 'Either the VAT ID or the country is wrong.'],
    ['vat.clean', 'info', 'tax', 'fix', 'VAT ID with spaces, dots or lower case', 'The number is valid; the fix writes it in one consistent form.'],
    ['oib.invalid', 'error', 'tax', '', 'OIB is not valid', 'A Croatian OIB has 11 digits and a check digit. Wrong OIBs make e-invoices fail.'],
    ['regno.format', 'warning', 'tax', '', 'Registration number has an unusual format', 'Slovene registration numbers have 7 digits, or 10 with the unit suffix.'],
    ['iban.format', 'error', 'bank', '', 'IBAN has the wrong format or length', 'Payments to this account will be rejected by the bank.'],
    ['iban.checksum', 'error', 'bank', '', 'IBAN check digits are wrong', 'The account number contains a typo; payments would fail or go astray.'],
    ['iban.local', 'warning', 'bank', 'fix', 'Account number without the IBAN prefix', 'Domestic account numbers work only at home; SEPA payments need the IBAN. The fix adds the country code and the check digits.'],
    ['iban.clean', 'info', 'bank', 'fix', 'IBAN with spaces or lower case', 'Valid, but most systems store it without spaces.'],
    ['bic.format', 'error', 'bank', '', 'BIC has the wrong format', 'A BIC has 8 or 11 characters: bank (4 letters), country (2), location (2) and an optional branch (3).'],
    ['bic.mismatch', 'warning', 'bank', '', 'BIC country differs from the IBAN country', 'The bank code probably belongs to another account.'],
    ['bic.clean', 'info', 'bank', 'fix', 'BIC with spaces or lower case', 'Valid, but written inconsistently.'],
    ['email.invalid', 'error', 'contact', '', 'E-mail address is not valid', 'Invoices and reminders sent here will bounce.'],
    ['email.typo', 'warning', 'contact', 'fix', 'Probable typo in the e-mail domain', 'The domain looks like a typo of a common one; mail would not arrive.'],
    ['email.clean', 'warning', 'contact', 'fix', 'E-mail with spaces or extra characters', 'Spaces, "mailto:" or brackets make the address unusable for sending.'],
    ['email.multi', 'warning', 'contact', '', 'Several e-mail addresses in one cell', 'Most systems accept one address per field. Move the others to contact persons.'],
    ['phone.invalid', 'error', 'contact', '', 'Phone number is not valid', 'Too short, too long or not a number at all.'],
    ['phone.multi', 'warning', 'contact', '', 'Several phone numbers in one cell', 'Split them into separate fields (phone, mobile) before the import.'],
    ['phone.format', 'info', 'contact', 'fix', 'Phone number not in international format', 'The fix writes every number as +386…/+385…, the format phones, CRMs and SMS tools understand.'],
    ['web.invalid', 'warning', 'contact', '', 'Website address looks wrong', 'Not a valid web address.'],
    ['postal.format', 'error', 'address', '', 'Postal code has the wrong format', 'Deliveries and address validation will fail.'],
    ['postal.zero', 'warning', 'address', 'fix', 'Postal code lost its leading zero', 'Excel turns 01067 into 1067. The fix puts the zero back.'],
    ['postal.unknown', 'warning', 'address', '', 'Postal code does not exist', 'The code has the right form but is not in the official list of Pošta Slovenije or Hrvatska pošta (embedded in this app), so a letter or parcel cannot be routed by it. Usually a typo or an old code.'],
    ['postal.city', 'warning', 'address', 'sug', 'City does not match the postal code', 'Either the postal code or the city is wrong. Each row suggests the city that belongs to the code.'],
    ['postal.clean', 'info', 'address', 'fix', 'Country prefix in the postal code', 'Old-style prefixes such as SI- or D- belong in the country field.'],
    ['country.unknown', 'error', 'address', '', 'Unknown country', 'The value is not a country we recognise.'],
    ['country.mixed', 'warning', 'address', 'fix', 'Country written in different ways', '"Slovenija", "SLO" and "SI" are the same country to people, not to software. The fix writes ISO codes.'],
    ['country.code', 'info', 'address', 'fix', 'Country not written as an ISO code', 'Import tools usually expect two-letter ISO codes such as SI and HR.'],
    ['ean.sci', 'error', 'product', '', 'Barcode turned into a number by Excel', 'Excel shows long numbers as 3,83E+12 and a CSV saved from it keeps only those digits. Export the column again, formatted as text.'],
    ['ean.checksum', 'error', 'product', '', 'Barcode check digit is wrong', 'The barcode cannot exist; usually a typo. A till will not find this product.'],
    ['ean.format', 'error', 'product', '', 'Barcode has the wrong length or characters', 'EAN and GTIN codes have 8, 12, 13 or 14 digits.'],
    ['ean.zero', 'warning', 'product', 'fix', 'Barcode lost its leading zero', 'Excel drops the 0 at the start of 13-digit barcodes. The fix puts it back.'],
    ['ean.clean', 'info', 'product', 'fix', 'Barcode with spaces or dashes', 'Valid, but stored inconsistently.'],
    ['unit.variant', 'warning', 'product', 'fix', 'Unit written in different ways', '"kos", "KOS" and "kom" are one unit to people but three to software. The fix writes the one you choose.'],
    ['vatrate.invalid', 'error', 'product', '', 'VAT rate is not a number', 'The VAT rate must be a number such as 22 or 9,5.'],
    ['vatrate.unusual', 'warning', 'product', '', 'Unusual VAT rate', 'Not one of the rates set in Settings. Check the rate before invoicing.'],
    ['vatrate.fraction', 'warning', 'product', 'fix', 'VAT rate written as a fraction', '0,22 instead of 22. The fix writes the percentage.'],
    ['price.negative', 'error', 'number', '', 'Negative price', 'A sales price below zero is almost always a mistake.'],
    ['price.zero', 'warning', 'number', '', 'Price is zero', 'Free products are rare; usually the price was never entered.'],
    ['price.outlier', 'info', 'number', '', 'Price far outside the usual range', 'Very far from the other prices; check for a misplaced decimal separator.'],
    ['num.invalid', 'error', 'number', '', 'Not a number', 'The column holds numbers, but this value cannot be read as one.'],
    ['num.mixed', 'warning', 'number', 'fix', 'Different decimal separators', 'Mixing 12,50 and 12.50 in one column makes an import read some amounts a hundred times too large or small.'],
    ['num.format', 'info', 'number', 'fix', 'Thousand separators or currency signs', 'Most import tools expect a plain number such as 1234,56.'],
    ['date.invalid', 'error', 'number', '', 'Not a valid date', 'Not a date we can read, or a date that does not exist.'],
    ['date.future', 'warning', 'number', '', 'Date in the future', 'The column records when the row was created, so a future date is a typo.'],
    ['date.mixed', 'warning', 'number', 'fix', 'Dates written in different formats', 'Mixed formats get misread on import (3.4. becomes 4 March). The fix writes the format most rows use.']
  ];
  var RULES = {};
  RULE_LIST.forEach(function (x, i) { RULES[x[0]] = { id: x[0], sev: x[1], group: x[2], fix: x[3] === 'fix', sug: x[3] === 'sug', title: x[4], why: x[5], order: i }; });

  // ── role guessing ──────────────────────────────────────────────────────
  function sampleValues(table, c, max) {
    var out = [], rows = table.rows, n = rows.length, step = Math.max(1, Math.floor(n / (max * 2)));
    for (var r = 0; r < n && out.length < max; r += step) { var v = core(rows[r][c]); if (v) out.push(v); }
    if (out.length < Math.min(max, 20)) { out = []; for (r = 0; r < n && out.length < max; r++) { v = core(rows[r][c]); if (v) out.push(v); } }
    return out;
  }
  function share(vals, fn) { var k = 0; vals.forEach(function (v) { if (fn(v)) k++; }); return vals.length ? k / vals.length : 0; }
  /** the role a column's values point to (≥ 80 % pass), or null */
  function contentRole(vals, home) {
    if (vals.length < 3) return null;
    var cands = [
      ['email', function (v) { var e = emailCheck(v); return e.ok || e.multi; }],
      ['iban', function (v) { var x = ibanCheck(v, home); return x.ok || x.local || /^[A-Z]{2}\d{2}[A-Z0-9 ]{10,}$/i.test(v); }],
      ['ean', function (v) { var x = eanCheck(v); return x.ok || x.sci; }],
      ['vat', function (v) { return /^[A-Za-z]{2}/.test(v.replace(/\s/g, '')) && vatCheck(v, home).ok; }],
      ['vat', function (v) { var d = v.replace(/[\s.]/g, ''); return /^\d{8}$/.test(d) && siTaxOk(d); }],
      ['oib', function (v) { return oibOk(v.replace(/\s/g, '')); }],
      ['bic', function (v) { return v.length >= 8 && bicCheck(v).ok && /\d|X{3}$|[A-Z]{2}[A-Z0-9]{2}$/.test(v.toUpperCase()) && v === v.toUpperCase(); }],
      ['phone', function (v) { return /^[+0(][\d\s()\/.+-]{5,}$/.test(v) && phoneCheck(v, home).ok; }],
      ['country', function (v) { return !!countryOf(v); }],
      ['date', function (v) { return parseDate(v).ok; }],
      ['website', function (v) { return /^(https?:\/\/|www\.)/i.test(v) && WEB_RE.test(v); }],
      ['unit', function (v) { return !!unitGroup(v); }],
      ['postal', function (v) { var m = /^(\d{4,5})\s+\D/.exec(v); return !!(m && (postOffice('SI', m[1]) || postOffice('HR', m[1]))); }],
      ['number', function (v) { return parseNumber(v).ok; }]
    ];
    for (var i = 0; i < cands.length; i++) if (share(vals, cands[i][1]) >= 0.8) return cands[i][0];
    return null;
  }
  /** roles per column from the headers (synonyms in sl/hr/en/de/it) and, where the header says nothing, from the values */
  function guessRoles(table, home) {
    var hs = table.headers, roles = [], src = [], prio = [];
    hs.forEach(function (h, c) {
      var r = table.hasHeader === false ? null : headerRole(h), s = 'header';
      if (r === 'name' && /^(opis|description)$/.test(headerKey(h))) prio[c] = 1;
      if (!r) { r = contentRole(sampleValues(table, c, 200), home || 'SI'); s = r ? 'content' : 'none'; }
      if (!r) r = 'text';
      // "Davčna številka" holding SI tax numbers is a VAT column; the same header with OIBs is an OIB column
      if (r === 'vat') { var v = sampleValues(table, c, 60); if (v.length >= 3 && share(v, function (x) { return oibOk(x.replace(/\s/g, '')); }) >= 0.8) r = 'oib'; }
      roles.push(r); src.push(s); prio[c] = prio[c] || (s === 'header' ? 3 : 2);
    });
    // roles that only make sense once: keep the best column, the others become plain text
    ROLES.forEach(function (R) {
      if (!R.unique) return;
      var cols = []; roles.forEach(function (r, c) { if (r === R.id) cols.push(c); });
      if (cols.length < 2) return;
      cols.sort(function (a, b) { return prio[b] - prio[a] || a - b; });
      cols.slice(1).forEach(function (c) { roles[c] = 'text'; });
    });
    return { roles: roles, src: src };
  }
  var SUPPLIER_HINT = /dobavit|dobavlja|supplier|vendor|lieferant|fornitor|szallit|kreditor/;
  var PRODUCT_HINT = /artik|izdel|product|cenik|price ?list|item|blago|zaloga|proizvod|katalog/;
  function guessType(table, roles, fileName) {
    var pr = 0;
    ['ean', 'sku', 'unit', 'price', 'vatrate'].forEach(function (r) { if (roles.indexOf(r) >= 0) pr++; });
    var hint = fold(fileName || '') + ' ' + table.headers.map(fold).join(' ');
    if (pr >= 2 || (pr >= 1 && PRODUCT_HINT.test(hint) && roles.indexOf('street') < 0)) return 'products';
    if (SUPPLIER_HINT.test(fold(fileName || '')) || table.headers.some(function (h) { return SUPPLIER_HINT.test(fold(h)) && headerRole(h) !== 'text'; })) return 'suppliers';
    return 'customers';
  }
  /** a product file's code column is its SKU; a partner file's is its ID */
  function rolesForType(roles, type) {
    var out = roles.slice();
    if (type === 'products' && out.indexOf('sku') < 0) { var i = out.indexOf('id'); if (i >= 0) out[i] = 'sku'; }
    if (type !== 'products' && out.indexOf('id') < 0) { var j = out.indexOf('sku'); if (j >= 0) out[j] = 'id'; }
    return out;
  }

  /** roles, where they came from, and the dataset type for a freshly read table */
  function autoSetup(table, fileName, home) {
    var g = guessRoles(table, home), type = guessType(table, g.roles, fileName);
    return { type: type, roles: rolesForType(g.roles, type), src: g.src };
  }

  // ── header row and table ───────────────────────────────────────────────
  /** which of the first rows is the header (title lines above it are skipped); index −1 means there is none */
  function detectHeader(rows) {
    var top = rows.slice(0, 30), maxCols = 0;
    top.forEach(function (r) { var k = r.length; while (k > 0 && !core(r[k - 1])) k--; if (k > maxCols) maxCols = k; });
    if (!rows.length) return { index: -1, synonyms: 0 };
    var best = -1, bestScore = -1e9, bestSyn = 0, bestTexty = 0, bestFilled = 0;
    for (var i = 0; i < Math.min(15, rows.length); i++) {
      var row = rows[i], cells = row.map(core).filter(function (v) { return v; });
      if (cells.length < Math.max(2, Math.ceil(maxCols * 0.5)) && !(maxCols === 1 && cells.length === 1)) continue;
      var syn = 0, texty = 0, seen = {}, dupes = 0;
      cells.forEach(function (v) {
        if (headerRole(v)) syn++;
        var looksData = parseNumber(v).ok || parseDate(v).ok || v.indexOf('@') >= 0 || v.length > 40;
        if (!looksData) texty++;
        var k = v.toLowerCase(); if (seen[k]) dupes++; seen[k] = 1;
      });
      var score = syn * 3 + texty - (cells.length - texty) * 2 - dupes * 2 - i * 0.1;
      if (score > bestScore) { bestScore = score; best = i; bestSyn = syn; bestTexty = texty; bestFilled = cells.length; }
    }
    if (best < 0) return { index: -1, synonyms: 0 };
    var hasHeader = bestSyn >= 2 || (bestSyn >= 1 && bestTexty >= bestFilled * 0.8) || (bestTexty === bestFilled && rows.length > best + 1 && (function () {
      // all-text row followed by a row that has numbers, dates or e-mails: a header without known names
      var next = rows[best + 1].map(core).filter(function (v) { return v; });
      return next.some(function (v) { return parseNumber(v).ok || parseDate(v).ok || v.indexOf('@') >= 0; });
    })());
    return { index: hasHeader ? best : -1, synonyms: bestSyn };
  }
  /** rows → { headers, rows (all as wide as the widest), lines, skipped, short, long, hasHeader, header } */
  function buildTable(rows, lines, headerIndex) {
    var hasHeader = headerIndex >= 0, hdr = hasHeader ? rows[headerIndex] : [], body = rows.slice(hasHeader ? headerIndex + 1 : 0);
    var bodyLines = (lines || []).slice(hasHeader ? headerIndex + 1 : 0);
    var hw = hdr.length; while (hw > 0 && !core(hdr[hw - 1])) hw--;
    var width = hw, short = 0, long = 0;
    body.forEach(function (r) { var k = r.length; while (k > 0 && !core(r[k - 1])) k--; if (k > width) width = k; });
    if (!width) width = 1;
    var seen = {}, headers = [];
    for (var c = 0; c < width; c++) {
      var h = hasHeader ? core(hdr[c]) : '';
      if (!h) h = 'Column ' + (c + 1);
      var base = h, n = 2; while (seen[h.toLowerCase()]) h = base + ' (' + (n++) + ')';
      seen[h.toLowerCase()] = 1; headers.push(h);
    }
    var out = body.map(function (r) {
      var k = r.length; while (k > 0 && !core(r[k - 1])) k--;
      if (hasHeader && r.length < hdr.length && k < hw) short++;
      if (hasHeader && k > hw) long++;
      if (r.length === width) return r.map(str);
      var o = new Array(width);
      for (var i = 0; i < width; i++) o[i] = i < r.length ? str(r[i]) : '';
      return o;
    });
    return { headers: headers, rows: out, lines: bodyLines.length === out.length ? bodyLines : out.map(function (x, i) { return i + (hasHeader ? 2 : 1); }),
      skipped: hasHeader ? headerIndex : 0, short: short, long: long, hasHeader: hasHeader, header: hasHeader ? (lines && lines[headerIndex]) || headerIndex + 1 : 0 };
  }
  /** text → table in one go (tests, pasted text, demo files) */
  function readText(text, opts) {
    opts = opts || {};
    var delim = opts.delim || sniffDelimiter(text), parsed = parseCsv(text, delim);
    var hi = opts.header != null ? opts.header : detectHeader(parsed.rows).index;
    var table = buildTable(parsed.rows, parsed.lines, hi);
    table.delim = delim;
    return table;
  }
  function toCsv(headers, rows, delim, bom) {
    var d = delim || ';';
    function q(v) { v = str(v); return v.indexOf(d) >= 0 || /["\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var out = [headers.map(q).join(d)];
    for (var i = 0; i < rows.length; i++) out.push(rows[i].map(q).join(d));
    return (bom ? '\uFEFF' : '') + out.join('\r\n') + '\r\n';
  }

  // ── analysis ───────────────────────────────────────────────────────────
  function pattern(v) {
    var s = v.length > 24 ? v.slice(0, 24) : v;
    return s.replace(/[A-Za-zÀ-ɏ]/g, 'A').replace(/\d/g, '9') + (v.length > 24 ? '…' : '');
  }
  function topN(map, n) {
    var top = [];
    map.forEach(function (cnt, k) {
      if (top.length < n || cnt > top[top.length - 1][1]) {
        top.push([k, cnt]); top.sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
        if (top.length > n) top.pop();
      }
    });
    return top;
  }
  function quantile(sorted, q) {
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function cmpIssue(a, b) { return a.r - b.r || a.c - b.c || RULES[a.k].order - RULES[b.k].order; }

  /** cfg: { type, roles, required, recommended, home, vatRates, today, unitTarget, dupThreshold, survivors, notDup, reuseDup } */
  function analysisJob(table, cfg) {
    cfg = cfg || {};
    var rows = table.rows, nR = rows.length, nC = table.headers.length, roles = cfg.roles || table.headers.map(function () { return 'text'; });
    var home = cfg.home || 'SI', today = cfg.today || fromUtc(Date.now());
    var vatRates = cfg.vatRates || VAT_RATES[home] || VAT_RATES.SI;
    var cols = {};
    roles.forEach(function (r, c) { (cols[r] = cols[r] || []).push(c); });
    var first = function (r) { return cols[r] ? cols[r][0] : -1; };
    var cName = first('name'), cCountry = first('country'), cVat = first('vat'), cPostal = first('postal'), cCity = first('city');
    var cIban = first('iban'), cBic = first('bic'), cEmail = first('email');
    var created = table.headers.map(function (h) { return CREATED_RE.test(fold(h)); });
    var required = (cfg.required || []).filter(function (r) { return ROLE[r]; }), recommended = (cfg.recommended || []).filter(function (r) { return ROLE[r] && required.indexOf(r) < 0; });
    var colInfo = table.headers.map(function () { return {}; });
    var base = [], rowCC = new Array(nR), filledN = new Uint16Array(nR), vatKey = new Array(nR), structure = [];
    required.forEach(function (r) { if (!cols[r]) structure.push({ r: -1, c: -1, k: 'req.nocolumn', p: r }); });
    recommended.forEach(function (r) { if (!cols[r]) structure.push({ r: -1, c: -1, k: 'rec.nocolumn', p: r }); });
    function add(r, c, k, p, f, s) { var o = { r: r, c: c, k: k }; if (p !== undefined) o.p = p; if (f !== undefined) o.f = f; if (s !== undefined) o.s = s; base.push(o); }

    // phase 0: column scans that decide what "consistent" means in each column
    var scanCols = [];
    roles.forEach(function (r, c) { if (r === 'country' || r === 'unit' || r === 'price' || r === 'number' || r === 'vatrate' || r === 'date' || r === 'ean') scanCols.push(c); });
    function scan(c) {
      var role = roles[c], info = colInfo[c], r, v;
      if (role === 'country') {
        var spell = {}, iso = 0, other = 0;
        for (r = 0; r < nR; r++) {
          v = core(rows[r][c]); if (!v || isPlaceholder(v, role)) continue;
          var code = countryOf(v); if (!code) continue;
          (spell[code] = spell[code] || {})[v] = 1;
          if (v === code) iso++; else other++;
        }
        info.countryMixed = (iso > 0 && other > 0) || Object.keys(spell).some(function (k) { return Object.keys(spell[k]).length > 1; });
        info.countrySpell = spell;
      } else if (role === 'unit') {
        var g = {};
        for (r = 0; r < nR; r++) { v = core(rows[r][c]); if (!v) continue; var grp = unitGroup(v); if (!grp) continue; g[grp] = g[grp] || {}; g[grp][v] = (g[grp][v] || 0) + 1; }
        info.unit = {};
        Object.keys(g).forEach(function (grp) {
          var sp = Object.keys(g[grp]).sort(function (a, b) { return g[grp][b] - g[grp][a] || (a < b ? -1 : 1); });
          var target = sp[0];
          if (grp === 'pc' && cfg.unitTarget && unitGroup(cfg.unitTarget) === 'pc') target = cfg.unitTarget;
          info.unit[grp] = { target: target, spellings: sp, counts: g[grp], mixed: sp.length > 1 || sp[0] !== target };
        });
      } else if (role === 'date') {
        var fams = {}, fmts = {};
        for (r = 0; r < nR; r++) {
          v = core(rows[r][c]); if (!v) continue;
          var pd = parseDate(v, { serial: true }); if (!pd.ok) continue;
          fams[pd.fam] = (fams[pd.fam] || 0) + 1; fmts[pd.fmt] = (fmts[pd.fmt] || 0) + 1;
        }
        var fam = Object.keys(fams).sort(function (a, b) { return fams[b] - fams[a] || (a === 'dot' ? -1 : 1); })[0] || 'dot';
        if (fam === 'serial') fam = 'dot';
        var fmt = Object.keys(fmts).filter(function (f) { return f !== 'serial' && famOf(f) === fam; }).sort(function (a, b) { return fmts[b] - fmts[a]; })[0] || DATE_FAM[fam];
        info.dateFam = fam; info.dateFmt = fmt;
      } else if (role === 'ean') {
        var l13 = 0, l12 = 0;
        for (r = 0; r < nR; r++) { v = core(rows[r][c]).replace(/[\s-]/g, ''); if (/^\d{13}$/.test(v)) l13++; else if (/^\d{12}$/.test(v)) l12++; }
        info.ean13 = l13 >= l12;
      } else {
        var cm = 0, pt = 0;
        for (r = 0; r < nR; r++) {
          v = core(rows[r][c]); if (!v) continue;
          if (/\d,\d{1,2}(\D*)$/.test(v) && !/\.\d{1,2}\D*$/.test(v)) cm++;
          else if (/\d\.\d{1,2}(\D*)$/.test(v) && !/,\d{1,2}\D*$/.test(v)) pt++;
          else if (/\d\.\d{3},\d/.test(v)) cm++;
          else if (/\d,\d{3}\.\d/.test(v)) pt++;
        }
        info.dec = pt > cm ? '.' : ',';
      }
    }
    function famOf(fmt) { return fmt === 'yyyy-mm-dd' ? 'iso' : fmt === 'dd.mm.yy' ? 'dot2' : fmt === 'dd/mm/yyyy' ? 'slash' : fmt === 'mm/dd/yyyy' ? 'us' : fmt === 'dd-mm-yyyy' ? 'dash' : fmt === 'serial' ? 'serial' : 'dot'; }

    // phase 1: every row
    var filled = new Uint8Array(nC);
    function checkRow(r) {
      var row = rows[r], cc = '', countryColCC = '', ctx = { postal: null, postalCity: '', ibanCC: '', bicCC: '', vat: null, cityCol: -1, cityVal: '' };
      if (cCountry >= 0) { var cv = core(row[cCountry]); if (cv) countryColCC = countryOf(fixMojibake(cv) || cv) || ''; }
      cc = countryColCC;
      if (!cc && cVat >= 0) { var vp = /^\s*([A-Za-z]{2})/.exec(str(row[cVat])); if (vp) { var pc = vp[1].toUpperCase(); if (VAT_RE[pc]) cc = pc === 'EL' ? 'GR' : pc === 'XI' ? 'GB' : pc; } }
      if (!cc) cc = home;
      rowCC[r] = cc;
      var nFilled = 0;
      for (var c = 0; c < nC; c++) {
        filled[c] = 0;
        var role = roles[c]; if (role === 'ignore') continue;
        var v = row[c]; if (v === '' || v == null) continue;
        v = str(v);
        var moji = v.length > 1 && MOJI_RE.test(v) ? fixMojibake(v) : null;
        if (moji != null) add(r, c, 'text.mojibake', undefined, moji);
        if (v.indexOf('\uFFFD') >= 0) add(r, c, 'text.lost');
        if (moji == null && WS_ANY.test(v)) {
          if (/^\s|\s$/.test(v) || /^[\u200B-\u200D\u2060\uFEFF]|[\u200B-\u200D\u2060\uFEFF]$/.test(v)) add(r, c, 'ws.trim', undefined, fixTrim(v));
          if (NBSP_RE.test(v)) add(r, c, 'ws.nbsp', undefined, fixNbsp(v));
          if (BREAK_RE.test(v.trim())) add(r, c, 'ws.newline', undefined, fixBreaks(v));
          if (CTRL_RE.test(v)) add(r, c, 'ws.control', undefined, fixControl(v));
          if (/\S {2,}\S/.test(v)) add(r, c, 'ws.double', undefined, fixDouble(v));
        }
        var t = core(moji != null ? moji : v);
        if (!t) continue;
        if (isPlaceholder(t, role)) { add(r, c, 'text.placeholder', t, ''); continue; }
        filled[c] = 1; nFilled++;
        checkValue(r, c, v, t, role, cc, countryColCC, ctx, moji != null);
      }
      filledN[r] = nFilled;
      // required and recommended fields: one issue per role when every column with that role is empty
      required.forEach(function (R) { var cs = cols[R]; if (cs && !cs.some(function (c) { return filled[c]; })) add(r, cs[0], 'req.missing', R); });
      recommended.forEach(function (R) { var cs = cols[R]; if (cs && !cs.some(function (c) { return filled[c]; })) add(r, cs[0], 'rec.missing', R); });
      // cross-field checks
      if (ctx.vat && ctx.vat.ok && countryColCC && ctx.vat.prefixed && ctx.vat.country !== countryColCC) add(r, cVat, 'vat.country', ctx.vat.cc + '|' + countryColCC);
      if (ctx.postal && (cc === 'SI' || cc === 'HR')) {
        var po = postOffice(cc, ctx.postal);
        var city = ctx.cityCol >= 0 ? ctx.cityVal : ctx.postalCity;
        if (po && city && !cityMatches(city, po)) add(r, ctx.cityCol >= 0 ? ctx.cityCol : cPostal, 'postal.city', ctx.postal + '|' + po.name, undefined, ctx.cityCol >= 0 ? po.name : ctx.postal + ' ' + po.name);
      }
      if (ctx.cityCol >= 0 && ctx.cityCaps) {
        var po2 = ctx.postal && (cc === 'SI' || cc === 'HR') ? postOffice(cc, ctx.postal) : null;
        add(r, ctx.cityCol, 'text.caps', undefined, po2 && cityMatches(ctx.cityVal, po2) ? po2.name : titleCase(ctx.cityRaw.trim(), 'city'));
      }
      if (ctx.ibanCC && ctx.bicCC && ctx.ibanCC !== ctx.bicCC && cBic >= 0) add(r, cBic, 'bic.mismatch', ctx.bicCC + '|' + ctx.ibanCC);
    }
    function checkValue(r, c, v, t, role, cc, countryColCC, ctx, wasMoji) {
      var info = colInfo[c], x;
      switch (role) {
        case 'name': case 'street':
          if (!wasMoji && isCaps(t)) add(r, c, 'text.caps', undefined, titleCase(v.trim(), role));
          break;
        case 'city':
          if (ctx.cityCol < 0) { ctx.cityCol = c; ctx.cityVal = t; ctx.cityRaw = v; ctx.cityCaps = !wasMoji && isCaps(t); }
          else if (!wasMoji && isCaps(t)) add(r, c, 'text.caps', undefined, titleCase(v.trim(), 'city'));
          break;
        case 'vat':
          x = vatCheck(t, countryColCC || home);
          if (x.skip) break;
          if (x.err === 'checksum') add(r, c, 'vat.checksum', x.cc);
          else if (x.err) add(r, c, 'vat.format', (x.cc || '') + (x.greek ? '|GR' : x.err === 'prefix' ? '|prefix' : ''));
          else {
            x.prefixed = /^[A-Za-z]{2}/.test(t);
            if (c === cVat) { ctx.vat = x; vatKey[r] = x.norm; }
            var vv = cfg.vies && cfg.vies[x.norm];
            if (vv && vv.valid === false) add(r, c, 'vat.vies', vv.at || '');
            if (t !== x.canon) add(r, c, 'vat.clean', undefined, x.canon);
          }
          break;
        case 'oib':
          var o = t.replace(/[\s.-]/g, '').replace(/^HR/i, '');
          if (!/^\d{11}$/.test(o)) add(r, c, 'oib.invalid', 'format');
          else if (!oibOk(o)) add(r, c, 'oib.invalid', 'checksum');
          else if (c === first('oib') && !vatKey[r]) vatKey[r] = 'HR' + o;
          break;
        case 'regno':
          if (cc === 'SI' && !/^\d{7}(\d{3})?$/.test(t.replace(/[\s.]/g, ''))) add(r, c, 'regno.format');
          break;
        case 'postal':
          x = postalCheck(t, cc);
          if (x.err) add(r, c, 'postal.format', cc + '|' + x.desc);
          else if (x.zero) { add(r, c, 'postal.zero', cc, x.fix); ctx.postal = x.code; ctx.postalCity = x.city; }
          else {
            if (x.ok && x.fix != null) add(r, c, 'postal.clean', undefined, x.fix);
            if (x.unknown) add(r, c, 'postal.unknown', cc + '|' + x.code);
            if (x.ok && c === cPostal) { ctx.postal = x.code; ctx.postalCity = x.city; }
          }
          break;
        case 'country':
          var code = countryOf(t);
          if (!code) add(r, c, 'country.unknown');
          else if (t !== code) add(r, c, info.countryMixed ? 'country.mixed' : 'country.code', code, code);
          break;
        case 'phone':
          x = phoneCheck(t, cc);
          if (x.multi) add(r, c, 'phone.multi', x.multi);
          else if (x.err) add(r, c, 'phone.invalid', x.err + (x.n != null ? '|' + x.n : ''));
          else if (x.e164 && !x.ext && !x.special && t !== x.e164) add(r, c, 'phone.format', undefined, x.e164);
          break;
        case 'email':
          x = emailCheck(v);
          if (x.multi) { add(r, c, 'email.multi', x.multi); if (x.bad) add(r, c, 'email.invalid', 'multi'); }
          else if (x.err) add(r, c, 'email.invalid', x.err);
          else if (x.typo) add(r, c, 'email.typo', x.typo, x.fix);
          else if (x.fix != null && x.fix !== v) add(r, c, 'email.clean', undefined, x.fix);
          break;
        case 'website':
          if (!WEB_RE.test(t)) add(r, c, 'web.invalid');
          break;
        case 'iban':
          x = ibanCheck(t, cc);
          if (x.local) add(r, c, 'iban.local', x.cc, x.fix);
          else if (x.err === 'checksum' || x.err === 'si56') add(r, c, 'iban.checksum', x.err === 'si56' ? 'si56' : x.cc);
          else if (x.err) add(r, c, 'iban.format', x.err + '|' + (x.cc || '') + '|' + (x.len || '') + '|' + (x.n || ''));
          else { if (c === cIban) ctx.ibanCC = x.cc; if (t !== x.norm) add(r, c, 'iban.clean', undefined, x.norm); }
          break;
        case 'bic':
          x = bicCheck(t);
          if (x.err) add(r, c, 'bic.format');
          else { if (c === cBic) ctx.bicCC = x.cc; if (t !== x.norm) add(r, c, 'bic.clean', undefined, x.norm); }
          break;
        case 'ean':
          x = eanCheck(t);
          if (x.sci) add(r, c, 'ean.sci');
          else if (x.err === 'checksum') add(r, c, 'ean.checksum', x.expect);
          else if (x.err === 'length' && x.n >= 9 && x.n <= 11 && gtinOk(('0000' + x.digits).slice(-13))) add(r, c, 'ean.zero', x.n, ('0000' + x.digits).slice(info.ean13 ? -13 : -12));
          else if (x.err) add(r, c, 'ean.format', x.err);
          else if (x.len === 12 && info.ean13) add(r, c, 'ean.zero', 12, '0' + x.digits);
          else if (x.digits !== t) add(r, c, 'ean.clean', undefined, x.digits);
          break;
        case 'unit':
          var grp = unitGroup(t), u = grp && info.unit && info.unit[grp];
          if (u && u.mixed && t !== u.target) add(r, c, 'unit.variant', grp, u.target);
          break;
        case 'vatrate':
          x = parseNumber(t, info.dec);
          if (!x.ok) { add(r, c, 'vatrate.invalid'); break; }
          if (x.n > 0 && x.n < 1) { var pct = Math.round(x.n * 10000) / 100; add(r, c, 'vatrate.fraction', undefined, plainNumber(pct, info.dec, pct % 1 ? 1 : 0)); break; }
          if (!rateIn(x.n, vatRates)) add(r, c, 'vatrate.unusual', home + '|' + x.n);
          numStyle(r, c, x, info);
          break;
        case 'price': case 'number':
          x = parseNumber(t, info.dec);
          if (!x.ok) { add(r, c, 'num.invalid'); break; }
          if (role === 'price') { if (x.n < 0) add(r, c, 'price.negative'); else if (x.n === 0) add(r, c, 'price.zero'); }
          numStyle(r, c, x, info);
          break;
        case 'date':
          x = parseDate(t, { serial: true });
          if (!x.ok) { add(r, c, 'date.invalid', x.why); break; }
          if (created[c] && x.iso > today) add(r, c, 'date.future', x.iso);
          if (x.fam !== info.dateFam) add(r, c, 'date.mixed', x.fmt, formatDate(x.iso, info.dateFmt));
          break;
      }
    }
    function numStyle(r, c, x, info) {
      if (x.dec && x.dec !== info.dec) add(r, c, 'num.mixed', x.dec, plainNumber(x.n, info.dec, x.fd));
      else if (x.thou || x.sym) add(r, c, 'num.format', undefined, plainNumber(x.n, info.dec, x.fd));
    }

    // phase 2: per column: profiles, duplicate codes, barcodes, price outliers (resumable, a slice of rows at a time)
    var profiles = new Array(nC), extra = [];
    function colStart(c) {
      var role = roles[c];
      return { c: c, r: 0, role: role, vals: new Map(), pats: new Map(), fillN: 0, capped: false, dmin: null, dmax: null, dn: 0, info: colInfo[c],
        nums: role === 'price' || role === 'number' || role === 'vatrate' ? { min: Infinity, max: -Infinity, sum: 0, n: 0 } : null,
        codeMap: role === 'id' || role === 'sku' ? new Map() : null, eanMap: role === 'ean' ? new Map() : null, prices: role === 'price' ? [] : null };
    }
    function colRows(st, stop) {
      var c = st.c, role = st.role, info = st.info, vals = st.vals, pats = st.pats, nums = st.nums;
      for (var r = st.r; r < stop; r++) {
        var v = core(rows[r][c]); if (!v) continue;
        st.fillN++;
        if (vals.has(v)) vals.set(v, vals.get(v) + 1); else if (vals.size < 10000) vals.set(v, 1); else st.capped = true;
        var p = pattern(v); if (pats.has(p)) pats.set(p, pats.get(p) + 1); else if (pats.size < 2000) pats.set(p, 1);
        if (role === 'ignore' || isPlaceholder(v, role)) continue;
        if (nums) { var x = parseNumber(v, info.dec); if (x.ok) { if (x.n < nums.min) nums.min = x.n; if (x.n > nums.max) nums.max = x.n; nums.sum += x.n; nums.n++; if (st.prices && x.n > 0) st.prices.push([x.n, r]); } }
        if (role === 'date') { var d = parseDate(v, { serial: true }); if (d.ok) { st.dn++; if (!st.dmin || d.iso < st.dmin) st.dmin = d.iso; if (!st.dmax || d.iso > st.dmax) st.dmax = d.iso; } }
        if (st.codeMap) { var key = v.toUpperCase(), a = st.codeMap.get(key); if (a) a.push(r); else st.codeMap.set(key, [r]); }
        if (st.eanMap) { var e = eanCheck(v); if (e.ok) { var k14 = ('00' + e.digits).slice(-14), b = st.eanMap.get(k14); if (b) b.push(r); else st.eanMap.set(k14, [r]); } }
      }
      st.r = stop;
    }
    function colEnd(st) {
      var c = st.c, info = st.info, nums = st.nums;
      profiles[c] = { filled: st.fillN, empty: nR - st.fillN, distinct: st.vals.size, capped: st.capped, top: topN(st.vals, 5), patterns: topN(st.pats, 5),
        num: nums && nums.n ? { min: nums.min, max: nums.max, avg: nums.sum / nums.n, n: nums.n } : null, date: st.dn ? { min: st.dmin, max: st.dmax, n: st.dn } : null,
        dec: info.dec || null, dateFmt: info.dateFmt || null, unit: info.unit || null, countryMixed: info.countryMixed };
      if (st.codeMap) st.codeMap.forEach(function (list) { if (list.length > 1) list.forEach(function (r) { extra.push({ r: r, c: c, k: 'id.dup', p: list.slice(0, 12) }); }); });
      if (st.eanMap) st.eanMap.forEach(function (list) { if (list.length > 1) list.forEach(function (r) { extra.push({ r: r, c: c, k: 'ean.dup', p: list.filter(function (x) { return x !== r; }).slice(0, 6) }); }); });
      var prices = st.prices;
      if (prices && prices.length >= 20) {
        var logs = prices.map(function (x) { return Math.log10(x[0]); }).sort(function (a, b) { return a - b; });
        var q1 = quantile(logs, 0.25), q3 = quantile(logs, 0.75), iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
        if (iqr > 0) prices.forEach(function (x) { var l = Math.log10(x[0]); if (l < lo || l > hi) extra.push({ r: x[1], c: c, k: 'price.outlier', p: [Math.pow(10, q1), Math.pow(10, q3)] }); });
      }
    }

    // phase 3: duplicate candidates (blocking keys, then pair scores)
    var dupKind = cfg.type === 'products' ? 'products' : 'partners', keys = null, blocks = null, blockList = null, bi = 0, pairsA = [], pairsB = [], pairsS = [], seenPairs = null;
    var dupOk = cName >= 0 && nR > 1, keyR = 0;
    var cEan = first('ean'), cSku = first('sku'), cPhone = cols.phone || [], cStreet = first('street');
    function rowKey(r) {
      var row = rows[r], nm = str(row[cName]); nm = fixMojibake(nm) || nm;
      var tokens = nameTokens(nm), k = { tokens: tokens, compact: tokens.join('') };
      if (dupKind === 'products') {
        if (cEan >= 0) { var e = eanCheck(core(row[cEan])); k.ean = e.ok ? ('00' + e.digits).slice(-14) : ''; }
        if (cSku >= 0) k.sku = core(row[cSku]).toUpperCase();
        k.nums = tokens.filter(function (x) { return /\d/.test(x); }).sort().join(' ');
        return k;
      }
      k.vat = vatKey[r] || '';
      k.emails = [];
      if (cEmail >= 0) { var ev = core(row[cEmail]).toLowerCase(); if (ev) k.emails = ev.split(/\s*[;,]\s*|\s+/).filter(function (x) { return x.indexOf('@') > 0; }); }
      k.phone = '';
      for (var i = 0; i < cPhone.length && !k.phone; i++) { var pv = core(row[cPhone[i]]); if (pv) { var ph = phoneCheck(pv, rowCC[r]); if (ph.ok && ph.e164) k.phone = ph.e164; } }
      k.postal = '';
      if (cPostal >= 0) { var px = postalCheck(core(row[cPostal]), rowCC[r]); if (px.ok || px.zero || px.skip) k.postal = (px.code || '').replace(/\s/g, ''); }
      k.street = cStreet >= 0 ? streetKey(fixMojibake(str(row[cStreet])) || row[cStreet]) : '';
      k.iban = '';
      if (cIban >= 0) { var ib = ibanCheck(core(row[cIban]), rowCC[r]); if (ib.ok) k.iban = ib.norm; }
      return k;
    }
    function blockKeys(k) {
      var out = [];
      if (k.compact.length >= 3) out.push('n:' + k.compact.slice(0, 4));
      if (dupKind === 'products') { if (k.ean) out.push('b:' + k.ean); return out; }
      if (k.vat) out.push('v:' + k.vat.replace(/^[A-Z]+/, ''));
      k.emails.forEach(function (e) { out.push('e:' + e); });
      if (k.phone) out.push('p:' + k.phone);
      if (k.postal && k.compact.length >= 3) out.push('z:' + k.postal + k.compact.slice(0, 3));
      return out;
    }
    function pairScore(a, b) {
      var ns = nameSim(a, b), s = ns * 100;
      if (dupKind === 'products') {
        // sizes and other numbers in the name tell variants apart (22/600/400 vs 22/600/500)
        if (a.nums !== b.nums) s -= 40;
        if (a.ean && b.ean) s += a.ean === b.ean ? 30 : -30; else s -= 10;
        if (a.sku && b.sku && a.sku === b.sku) s += 10;
      } else {
        if (a.vat && b.vat) s += a.vat === b.vat ? 25 : -35;
        if (a.emails.length && b.emails.length && a.emails.some(function (e) { return b.emails.indexOf(e) >= 0; })) s += 15;
        if (a.phone && b.phone && a.phone === b.phone) s += 10;
        if (a.iban && b.iban && a.iban === b.iban) s += 15;
        if (a.street && b.street) { var st = a.street === b.street ? 1 : jaroWinkler(a.street, b.street); if (st >= 0.92) s += 8; else if (st < 0.8) s -= 10; }
        if (a.postal && b.postal) s += a.postal === b.postal ? 4 : -10;
      }
      return Math.max(0, Math.min(100, Math.round(s)));
    }
    function addPair(i, j) {
      if (i === j) return;
      if (i > j) { var t = i; i = j; j = t; }
      var key = i * nR + j; if (seenPairs.has(key)) return; seenPairs.add(key);
      var s = pairScore(keys[i], keys[j]);
      if (s >= MIN_PAIR) { pairsA.push(i); pairsB.push(j); pairsS.push(s); }
    }
    /** score the pairs of one block, at most `max` of them; returns how many it scored, or −1 when the block is done.
     * Small blocks compare every pair; large ones are sorted by name and each row is compared with its next 15 neighbours. */
    var blk = null;
    function dupBlock(list, max) {
      if (!blk) {
        if (list.length > 5000) return -1;
        blk = { list: list.length <= 60 ? list : list.slice().sort(function (x, y) { return keys[x].compact < keys[y].compact ? -1 : keys[x].compact > keys[y].compact ? 1 : x - y; }), a: 0, b: 1, win: list.length <= 60 ? list.length : 15 };
      }
      var L = blk.list, n = L.length, done = 0;
      while (blk.a < n - 1) {
        var lim = Math.min(n, blk.a + blk.win);
        if (blk.win === n) lim = n;
        if (blk.b >= lim) { blk.a++; blk.b = blk.a + 1; continue; }
        addPair(L[blk.a], L[blk.b]); blk.b++;
        if (++done >= max) return done;
      }
      blk = null; return -1;
    }

    var phase = 0, scanI = 0, r = 0, colI = 0, colSt = null, res = null;
    var job = { done: false, progress: 0, label: 'Reading columns', result: null, step: step };
    var W = [0.04, 0.6, 0.2, 0.15, 0.01];
    function at(ph, frac) { var s = 0; for (var i = 0; i < ph; i++) s += W[i]; return Math.min(0.999, s + W[ph] * frac); }
    function step(budget) {
      budget = budget || 50000;
      while (budget > 0 && !job.done) {
        if (phase === 0) {
          if (scanI >= scanCols.length) { phase = 1; job.label = 'Checking values'; continue; }
          scan(scanCols[scanI++]); budget -= nR; job.progress = at(0, scanI / Math.max(1, scanCols.length));
        } else if (phase === 1) {
          if (r >= nR) { phase = 2; job.label = 'Profiling columns'; continue; }
          checkRow(r++); budget -= nC + 4; if ((r & 63) === 0 || r === nR) job.progress = at(1, r / Math.max(1, nR));
        } else if (phase === 2) {
          if (colI >= nC && !colSt) {
            phase = 3; job.label = 'Looking for duplicates';
            if (cfg.reuseDup && cfg.reuseDup.n === nR && cfg.reuseDup.kind === dupKind && dupOk) { pairsA = cfg.reuseDup.a; pairsB = cfg.reuseDup.b; pairsS = cfg.reuseDup.s; keys = cfg.reuseDup.keys; phase = 4; }
            else if (!dupOk) phase = 4;
            else { keys = new Array(nR); blocks = new Map(); seenPairs = new Set(); }
            continue;
          }
          if (!colSt) colSt = colStart(colI);
          var from = colSt.r, stop = Math.min(nR, from + Math.max(500, budget));
          colRows(colSt, stop); budget -= stop - from + 50;
          if (colSt.r >= nR) { colEnd(colSt); colSt = null; colI++; }
          job.progress = at(2, (colI + (colSt ? colSt.r / Math.max(1, nR) : 0)) / Math.max(1, nC));
        } else if (phase === 3) {
          if (keyR < nR) {
            var stop = Math.min(nR, keyR + 400);
            for (; keyR < stop; keyR++) {
              keys[keyR] = rowKey(keyR);
              blockKeys(keys[keyR]).forEach(function (bk) { var l = blocks.get(bk); if (l) l.push(keyR); else blocks.set(bk, [keyR]); });
            }
            budget -= 4000; job.progress = at(3, 0.3 * keyR / nR);
            if (keyR >= nR) { blockList = []; blocks.forEach(function (l) { if (l.length > 1) blockList.push(l); }); blocks = null; }
            continue;
          }
          if (bi >= blockList.length) { phase = 4; seenPairs = null; continue; }
          var got = dupBlock(blockList[bi], Math.max(50, Math.floor(budget / 8)));
          if (got < 0) bi++; else budget -= got * 8;
          budget -= 10; job.progress = at(3, 0.3 + 0.7 * bi / blockList.length);
        } else if (phase === 4) {
          job.label = 'Scoring'; res = prepareResult(); phase = 5; budget -= 30000; job.progress = at(4, 0.4);
        } else {
          applyDupes(res, table, cfg);
          job.result = res; job.done = true; job.progress = 1;
        }
      }
      return job;
    }
    function prepareResult() {
      base = base.concat(extra);
      base.sort(cmpIssue);
      return {
        nRows: nR, nCols: nC, roles: roles.slice(), type: cfg.type || 'customers', home: home, today: today, vatRates: vatRates,
        base: base, structure: structure, profiles: profiles, rowCC: rowCC, filledN: filledN, vatKey: vatKey,
        cols: { name: cName, id: first('id'), sku: first('sku'), country: cCountry, vat: cVat, postal: cPostal, city: cCity, email: cEmail },
        dup: { kind: dupKind, ok: dupOk, n: nR, a: pairsA, b: pairsB, s: pairsS, keys: keys }
      };
    }
    if (!nR) { job.label = 'Scoring'; }
    return job;
  }
  function analyze(table, cfg) { var j = analysisJob(table, cfg); while (!j.done) j.step(1e9); return j.result; }

  // ── duplicates: groups, survivors, dependent issues, scores ────────────
  function clusters(dup, threshold, notDup) {
    var n = dup.n, parent = new Int32Array(n), i, nd = notDup && Object.keys(notDup).length ? notDup : null;
    for (i = 0; i < n; i++) parent[i] = i;
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    var edges = [];
    for (i = 0; i < dup.a.length; i++) {
      if (dup.s[i] < threshold) continue;
      var a = dup.a[i], b = dup.b[i];
      if (nd && nd[a + ':' + b]) continue;
      edges.push(i);
      var ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
    // a group: its rows, its best pair score and its pairs (indexes into dup.a / dup.b / dup.s)
    var groups = new Map();
    for (i = 0; i < edges.length; i++) {
      var e = edges[i], root = find(dup.a[e]), g = groups.get(root);
      if (!g) { g = { rows: [], score: 0, pairs: [] }; groups.set(root, g); }
      g.pairs.push(e);
      if (dup.s[e] > g.score) g.score = dup.s[e];
    }
    var out = [];
    groups.forEach(function (g) {
      var set = new Set(); g.pairs.forEach(function (e) { set.add(dup.a[e]); set.add(dup.b[e]); });
      g.rows = Array.from(set).sort(function (x, y) { return x - y; });
      out.push(g);
    });
    out.sort(function (x, y) { return y.score - x.score || y.rows.length - x.rows.length || x.rows[0] - y.rows[0]; });
    return out;
  }
  function errorCount(base) { var m = {}; base.forEach(function (x) { if (x.r >= 0 && RULES[x.k].sev === 'error') m[x.r] = (m[x.r] || 0) + 1; }); return m; }
  /** recompute duplicate groups and everything that depends on them, then the counts and scores */
  function applyDupes(res, table, cfg) {
    cfg = cfg || {};
    var threshold = cfg.dupThreshold || 85, surv = cfg.survivors || {}, errs = errorCount(res.base);
    var groups = res.dup.ok ? clusters(res.dup, threshold, cfg.notDup) : [];
    var dupIssues = [], groupOf = new Int32Array(res.nRows).fill(-1), nameCol = res.cols.name >= 0 ? res.cols.name : 0;
    groups.forEach(function (g, gi) {
      var chosen = g.rows.filter(function (r) { return surv[r]; })[0];
      if (chosen == null) chosen = g.rows.slice().sort(function (a, b) { return res.filledN[b] - res.filledN[a] || (errs[a] || 0) - (errs[b] || 0) || a - b; })[0];
      g.survivor = chosen; g.auto = !surv[chosen];
      // each row's match with the survivor, or else its best match in the group
      var withS = {}, best = {};
      g.pairs.forEach(function (e) {
        var a = res.dup.a[e], b = res.dup.b[e], sc = res.dup.s[e];
        if (a === chosen) withS[b] = sc; else if (b === chosen) withS[a] = sc;
        if (!(best[a] >= sc)) best[a] = sc; if (!(best[b] >= sc)) best[b] = sc;
      });
      g.match = withS;
      g.rows.forEach(function (r) {
        groupOf[r] = gi;
        if (r !== chosen) dupIssues.push({ r: r, c: nameCol, k: 'dup.record', p: [chosen, withS[r] || best[r] || 0] });
      });
    });
    // the same VAT ID on records that do not look like the same partner
    if (res.type !== 'products' && res.vatKey) {
      var byVat = new Map();
      res.vatKey.forEach(function (k, r) { if (!k) return; var l = byVat.get(k); if (l) l.push(r); else byVat.set(k, [r]); });
      var vc = res.cols.vat >= 0 ? res.cols.vat : nameCol;
      byVat.forEach(function (list) {
        if (list.length < 2) return;
        list.forEach(function (r) {
          var other = list.filter(function (o) { return o !== r && (groupOf[o] < 0 || groupOf[o] !== groupOf[r]); });
          if (other.length) dupIssues.push({ r: r, c: vc, k: 'vat.dup', p: other.slice(0, 6) });
        });
      });
    }
    dupIssues.sort(cmpIssue);
    // merge the two sorted lists
    var all = new Array(res.base.length + dupIssues.length), i = 0, j = 0, k = 0;
    while (i < res.base.length || j < dupIssues.length) {
      if (j >= dupIssues.length || (i < res.base.length && cmpIssue(res.base[i], dupIssues[j]) <= 0)) all[k++] = res.base[i++]; else all[k++] = dupIssues[j++];
    }
    res.issues = all; res.groups = groups; res.groupOf = groupOf; res.threshold = threshold;
    var nR = res.nRows, rowStart = new Int32Array(nR + 1), p = 0;
    for (var r = 0; r <= nR; r++) { while (p < all.length && all[p].r < r) p++; rowStart[r] = p; }
    res.rowStart = rowStart;
    // counts per rule and severity
    var rules = {}, sev = { error: 0, warning: 0, info: 0 };
    res.structure.concat(all).forEach(function (x, idx) {
      var R = RULES[x.k], o = rules[x.k] || (rules[x.k] = { k: x.k, n: 0, rows: 0, fixable: 0, first: [], last: -2 });
      o.n++; sev[R.sev]++;
      if (x.r >= 0 && x.r !== o.last) { o.rows++; o.last = x.r; }
      if (x.f !== undefined) o.fixable++;
      if (o.first.length < 60) o.first.push(x);
    });
    Object.keys(rules).forEach(function (k) { delete rules[k].last; });
    res.rules = rules; res.counts = sev;
    var sc = scores(res, false), sa = scores(res, true);
    res.score = sc.score; res.colScores = sc.cols; res.rowW = sc.rowW; res.scoreAfter = sa.score;
    res.rowsErr = sc.rowsErr; res.rowsWarn = sc.rowsWarn; res.rowsClean = nR - sc.rowsErr - sc.rowsWarn;
    return res;
  }
  /** score = 100 × (1 − Σ row weights ÷ (3 × rows)); a row weighs 3 with an error, 1 with only warnings, 0 otherwise.
   * Column scores use the same formula on the column's cells. With `afterFix`, issues that have a one-click fix count as fixed. */
  function scores(res, afterFix) {
    var nR = res.nRows, nC = res.nCols, rowW = new Uint8Array(nR), colSum = new Float64Array(nC), all = res.issues;
    var curR = -1, curC = -1, cellW = 0, rowsErr = 0, rowsWarn = 0;
    function flushCell() { if (curC >= 0 && curR >= 0) colSum[curC] += cellW; }
    for (var i = 0; i < all.length; i++) {
      var x = all[i]; if (x.r < 0) continue;
      if (afterFix && x.f !== undefined) continue;
      var w = SEV_W[RULES[x.k].sev];
      if (x.r !== curR || x.c !== curC) { flushCell(); curR = x.r; curC = x.c; cellW = 0; }
      if (w > cellW) cellW = w;
      if (w > rowW[x.r]) rowW[x.r] = w;
    }
    flushCell();
    // a required column that is not in the file at all: every row lacks that field
    if (res.structure.some(function (x) { return x.k === 'req.nocolumn'; })) for (var m = 0; m < nR; m++) rowW[m] = 3;
    var tot = 0;
    for (var r = 0; r < nR; r++) { tot += rowW[r]; if (rowW[r] === 3) rowsErr++; else if (rowW[r] === 1) rowsWarn++; }
    function pct(sum, max) { if (!max) return 100; var s = Math.round(100 * (1 - sum / max)); return sum > 0 ? Math.min(99, s) : s; }
    var cols = [];
    for (var c = 0; c < nC; c++) cols.push(res.roles[c] === 'ignore' ? null : pct(colSum[c], 3 * nR));
    return { score: pct(tot, 3 * nR), cols: cols, rowW: rowW, rowsErr: rowsErr, rowsWarn: rowsWarn };
  }
  function scoreBand(s) { return s >= 90 ? 'good' : s >= 75 ? 'fair' : s >= 50 ? 'poor' : 'critical'; }

  // ── messages ───────────────────────────────────────────────────────────
  var COUNTRY_NAME = { SI: 'Slovenia', HR: 'Croatia', AT: 'Austria', DE: 'Germany', IT: 'Italy', HU: 'Hungary', CZ: 'Czechia', SK: 'Slovakia', PL: 'Poland',
    FR: 'France', ES: 'Spain', NL: 'the Netherlands', BE: 'Belgium', LU: 'Luxembourg', CH: 'Switzerland', GB: 'the United Kingdom', IE: 'Ireland',
    RS: 'Serbia', BA: 'Bosnia and Herzegovina', ME: 'Montenegro', MK: 'North Macedonia', BG: 'Bulgaria', RO: 'Romania', GR: 'Greece', PT: 'Portugal',
    DK: 'Denmark', SE: 'Sweden', FI: 'Finland', NO: 'Norway', LI: 'Liechtenstein', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', MT: 'Malta', CY: 'Cyprus' };
  function cname(cc) { return COUNTRY_NAME[cc] || cc; }
  function rowList(rows, lines) { return rows.slice(0, 5).map(function (r) { return lines ? lines[r] : r + 1; }).join(', ') + (rows.length > 5 ? '…' : ''); }
  /** the English sentence for an issue; ctx = { table, res } for row numbers and role names */
  function message(x, ctx) {
    ctx = ctx || {};
    var lines = ctx.table && ctx.table.lines, p = x.p, sp = typeof p === 'string' ? p.split('|') : [];
    var typeName = ctx.res ? (TYPE[ctx.res.type] || TYPE.customers).many : 'records';
    var ln = function (r) { return lines ? lines[r] : r + 1; };
    switch (x.k) {
      case 'req.nocolumn': return 'No ' + ROLE[p].name + ' column, which ' + typeName + ' need. Mark a column with this role on the Columns tab, or add it to the export.';
      case 'rec.nocolumn': return 'No ' + ROLE[p].name + ' column (recommended for ' + typeName + ').';
      case 'req.missing': return ROLE[p].name + ' is empty, and ' + typeName + ' need it.';
      case 'rec.missing': return ROLE[p].name + ' is empty (recommended).';
      case 'text.placeholder': return '"' + p + '" is a placeholder, not a value.';
      case 'id.dup': return 'The same code is used by ' + p.length + ' rows (rows ' + rowList(p, lines) + ').';
      case 'dup.record': return 'Looks like a duplicate of row ' + ln(p[0]) + ' (match ' + p[1] + ' of 100).';
      case 'vat.dup': return 'Same VAT ID as row ' + rowList(p, lines) + ', but the records look different: a branch, or a VAT ID copied to the wrong record.';
      case 'ean.dup': return 'Same barcode as row ' + rowList(p, lines) + '.';
      case 'text.mojibake': return 'Broken characters from a wrong encoding (for example "Å¡" instead of "š").';
      case 'text.lost': return 'Contains "\uFFFD": a letter was lost in an earlier conversion. Correct it by hand.';
      case 'ws.trim': return 'Spaces at the start or end.';
      case 'ws.nbsp': return 'Contains non-breaking or invisible spaces.';
      case 'ws.newline': return 'Line break inside the cell.';
      case 'ws.control': return 'Contains a tab or a control character.';
      case 'ws.double': return 'Two or more spaces in a row.';
      case 'text.caps': return 'Written in capitals.';
      case 'vat.format':
        if (sp[1] === 'prefix') return '"' + sp[0] + '" is not a VAT country prefix.';
        if (sp[1] === 'GR') return 'Greek VAT IDs start with EL, not GR.';
        return 'Not a valid ' + cname(sp[0] === 'EL' ? 'GR' : sp[0]) + ' VAT ID: expected ' + (VAT_DESC[sp[0]] || 'a country prefix and digits') + '.' +
          (sp[0] === 'SI' || sp[0] === 'HR' ? '' : ' Format check only: there is no check-digit test for this country here.');
      case 'vat.checksum': return p === 'SI' ? 'The check digit (the 8th digit) does not match: this Slovene tax number cannot exist. Probably a typo.' : 'The OIB check digit (the last digit) does not match: this Croatian VAT ID cannot exist. Probably a typo.';
      case 'vat.vies': return 'VIES says this VAT ID is not valid' + (p ? ' (checked ' + String(p).slice(8, 10).replace(/^0/, '') + '. ' + String(p).slice(5, 7).replace(/^0/, '') + '. ' + String(p).slice(0, 4) + ')' : '') + '.';
      case 'vat.country': return 'The VAT ID is for ' + cname(sp[0] === 'EL' ? 'GR' : sp[0]) + ' but the country is ' + cname(sp[1]) + '.';
      case 'vat.clean': return 'Spaces, dots or lower-case letters in the VAT ID.';
      case 'oib.invalid': return p === 'format' ? 'An OIB has exactly 11 digits.' : 'The OIB check digit (the last digit) does not match: this OIB cannot exist.';
      case 'regno.format': return 'Slovene registration numbers have 7 digits (10 with the unit suffix).';
      case 'iban.format':
        if (sp[0] === 'country') return '"' + sp[1] + '" is not an IBAN country.';
        if (sp[0] === 'length') return cname(sp[1]) + ' IBANs have ' + sp[2] + ' characters; this one has ' + sp[3] + '.';
        return 'An IBAN starts with a country code and 2 check digits (for example SI56…).';
      case 'iban.checksum': return p === 'si56' ? 'Slovene IBANs always start with SI56; the account number\'s own check digits do not match.' : 'The IBAN check digits do not match (mod 97): a digit is wrong or two are swapped.';
      case 'iban.local': return (p === 'HR' ? 'Croatian' : 'Slovene') + ' account number without the IBAN prefix.';
      case 'iban.clean': return 'Spaces or lower-case letters; most systems store IBANs without spaces.';
      case 'bic.format': return 'A BIC has 8 or 11 characters: bank (4 letters), country (2 letters), location (2) and an optional branch (3).';
      case 'bic.mismatch': return 'The BIC is for a bank in ' + cname(sp[0]) + ' but the IBAN is from ' + cname(sp[1]) + '.';
      case 'bic.clean': return 'Spaces or lower-case letters in the BIC.';
      case 'email.invalid': return { noat: 'No @ sign.', multiat: 'More than one @ sign.', local: 'The part before the @ is not valid.', domain: 'The part after the @ is not a valid domain.', multi: 'One of the addresses in the cell is not valid.' }[p] || 'Not a valid e-mail address.';
      case 'email.typo': return 'Probably @' + p + ': the domain looks like a typo.';
      case 'email.clean': return 'Spaces, "mailto:" or brackets around the address.';
      case 'email.multi': return p + ' addresses in one cell; most systems accept one.';
      case 'phone.invalid':
        if (sp[0] === 'letters') return 'Contains letters.';
        if (sp[0] === 'si') return 'Slovene numbers have 8 digits after +386 (9 with the leading 0)' + (sp[1] ? '; this one has ' + sp[1] : '') + '.';
        if (sp[0] === 'hr') return 'Croatian numbers have 8 or 9 digits after +385' + (sp[1] ? '; this one has ' + sp[1] : '') + '.';
        return sp[0] === 'long' ? 'Too many digits for a phone number.' : 'Too few digits for a phone number.';
      case 'phone.format': return 'In international format: ' + x.f + '.';
      case 'phone.multi': return p + ' phone numbers in one cell.';
      case 'web.invalid': return 'Does not look like a web address.';
      case 'postal.format': return cname(sp[0]) + ' postal codes have ' + sp[1] + '.';
      case 'postal.zero': return 'Lost its leading zero: ' + cname(p) + ' postal codes have 5 digits.';
      case 'postal.city': return sp[0] + ' is the postal code of ' + sp[1] + '.';
      case 'postal.unknown': return sp[1] + ' is not in the official list of ' + (sp[0] === 'HR' ? 'Hrvatska pošta' : 'Pošta Slovenije') + '.';
      case 'postal.clean': return 'Country prefix in the postal code.';
      case 'country.unknown': return 'Not a country we recognise.';
      case 'country.mixed': return 'This column writes the same country in different ways; the ISO code is ' + p + '.';
      case 'country.code': return 'The ISO code is ' + p + '.';
      case 'ean.sci': return 'Excel turned this barcode into a number such as 3,83E+12; the digits are lost. Export the column again as text.';
      case 'ean.checksum': return 'The check digit should be ' + p + '.';
      case 'ean.format': return p === 'chars' ? 'Contains characters other than digits.' : 'A barcode has 8, 12, 13 or 14 digits.';
      case 'ean.zero': return 'Lost its leading zero' + (p && p < 12 ? 's' : '') + ' (' + (p || 12) + ' digits): Excel drops zeros at the start of numbers. With them back it is a valid barcode.';
      case 'ean.clean': return 'Spaces or dashes in the barcode.';
      case 'unit.variant': return 'The same unit is written in different ways; use ' + x.f + '.';
      case 'vatrate.invalid': return 'Not a number.';
      case 'vatrate.unusual': return sp[1].replace('.', ',') + ' % is not a ' + cname(sp[0]) + ' VAT rate in Settings.';
      case 'vatrate.fraction': return 'Written as a fraction; as a percentage: ' + x.f + '.';
      case 'price.negative': return 'The price is below zero.';
      case 'price.zero': return 'The price is 0.';
      case 'price.outlier': return 'Far from the other prices (the middle half is between ' + fmtN(p[0]) + ' and ' + fmtN(p[1]) + ').';
      case 'num.invalid': return 'Not a number.';
      case 'num.mixed': return 'Decimal ' + (p === '.' ? 'point' : 'comma') + ', while most values in this column use a decimal ' + (p === '.' ? 'comma' : 'point') + '.';
      case 'num.format': return 'Thousand separators or a currency sign; most import tools expect a plain number.';
      case 'date.invalid': return p === 'impossible' ? 'No such date (for example 31 February).' : 'Not a date we can read.';
      case 'date.future': return 'After today, in a column that records when the row was created.';
      case 'date.mixed': return 'Written as ' + (p === 'serial' ? 'an Excel serial number' : p) + ', while most dates in this column use another format.';
    }
    return RULES[x.k] ? RULES[x.k].title + '.' : x.k;
  }
  function fmtN(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €'; }

  // ── merging duplicates ─────────────────────────────────────────────────
  /** the survivor's row with its empty cells filled from the other rows of the group (in row order) */
  function mergeRow(rows, group, survivor) {
    var out = rows[survivor].slice();
    for (var c = 0; c < out.length; c++) {
      if (core(out[c])) continue;
      for (var i = 0; i < group.length; i++) { var r = group[i]; if (r !== survivor && core(rows[r][c])) { out[c] = rows[r][c]; break; } }
    }
    return out;
  }

  // ── fix everything: one value per cell, applied in passes ─────────────
  var WS_FIX = { 'ws.control': fixControl, 'ws.nbsp': fixNbsp, 'ws.newline': fixBreaks, 'ws.double': fixDouble, 'ws.trim': fixTrim };
  var WS_ORDER = ['ws.control', 'ws.nbsp', 'ws.newline', 'ws.double', 'ws.trim'];
  /** the one-click fixes of a result as one new value per cell: [{ r, c, v, k: [rule ids] }]. `rules` (optional) limits them to
   * those rule ids. Several space fixes on one cell are combined; when a cell also has another fix (capitals, placeholder,
   * phone format …) that one is used, and a next pass picks up what is left. */
  function planFixes(res, table, rules) {
    var only = rules ? setOf(rules) : null, out = [], list = res.issues, i = 0;
    while (i < list.length) {
      var r = list[i].r, c = list[i].c, ws = [], other = null, ks = [];
      for (; i < list.length && list[i].r === r && list[i].c === c; i++) {
        var x = list[i];
        if (x.f === undefined || x.r < 0 || (only && !only[x.k])) continue;
        if (WS_FIX[x.k]) ws.push(x.k); else if (!other) other = x;
      }
      if (r < 0) continue;
      var v = null;
      if (other) { v = other.f; ks.push(other.k); }
      else if (ws.length) { v = str(table.rows[r][c]); WS_ORDER.forEach(function (k) { if (ws.indexOf(k) >= 0) v = WS_FIX[k](v); }); ks = ws; }
      if (v != null && v !== table.rows[r][c]) out.push({ r: r, c: c, v: v, k: ks });
    }
    return out;
  }
  /** apply the fixes pass by pass until none is left (at most `max` passes); changes table.rows in place.
   * → { res, changes: [[r, c, before, after]], passes, rules: { id: cells } }. The app runs the same loop with its chunked job. */
  function fixAll(table, cfg, rules, max) {
    var res = analyze(table, cfg), seen = {}, changes = [], passes = 0, byRule = {};
    while (passes < (max || 4)) {
      var plan = planFixes(res, table, rules);
      if (!plan.length) break;
      plan.forEach(function (x) {
        var key = x.r + ':' + x.c;
        if (seen[key] == null) { seen[key] = changes.length; changes.push([x.r, x.c, table.rows[x.r][x.c], x.v]); } else changes[seen[key]][3] = x.v;
        table.rows[x.r][x.c] = x.v;
        x.k.forEach(function (k) { byRule[k] = (byRule[k] || 0) + 1; });
      });
      passes++;
      res = analyze(table, cfg);
    }
    return { res: res, changes: changes.filter(function (ch) { return ch[2] !== ch[3]; }), passes: passes, rules: byRule };
  }

  // ── online VAT check (VIES) ────────────────────────────────────────────
  /** VAT prefixes the EU's VIES service answers for: the 27 member states (Greece as EL) and XI (Northern Ireland) */
  var VIES_CC = setOf('AT BE BG CY CZ DE DK EE EL ES FI FR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK XI');
  /** the distinct VAT IDs of a result that pass the local checks and that VIES can confirm: [{ norm, cc, num, rows }] */
  function viesCandidates(res, table) {
    var c = res.cols.vat, out = [], at = {};
    if (c == null || c < 0 || res.type === 'products') return out;
    for (var r = 0; r < res.nRows; r++) {
      var t = core(table.rows[r][c]); if (!t || isPlaceholder(t, 'vat')) continue;
      var cc = res.rowCC[r], x = vatCheck(t, cc === 'GR' ? 'GR' : cc);
      if (!x.ok || !VIES_CC[x.cc]) continue;
      if (at[x.norm] == null) { at[x.norm] = out.length; out.push({ norm: x.norm, cc: x.cc, num: x.norm.slice(2), rows: [] }); }
      out[at[x.norm]].rows.push(r);
    }
    return out;
  }

  // ── e-invoice readiness ────────────────────────────────────────────────
  /* What a partner record needs so that an e-invoice to it (or from it) goes through without manual work. The fields follow the
   * buyer/seller part of the European e-invoice standard EN 16931 (name BT-44, VAT identifier BT-48, postal address BT-50…BT-55,
   * electronic address BT-49) that Croatian B2B e-invoices use since 1 Jan 2026 (Zakon o fiskalizaciji, NN 89/2025) and Slovene
   * B2B e-invoices will use from 1 Jan 2028. The e-mail stands in for the electronic address (most SMEs still deliver by e-mail or
   * an intermediary that needs a contact); the IBAN counts for suppliers (you pay them) and when the file has an IBAN column.
   * Tax ID: only for partners in the EU, where the VAT ID (or the Croatian OIB) is mandatory on the invoice. */
  var EINV = [
    ['name', 'Company name', 'The legal name of the partner (BT-44).'],
    ['taxid', 'Valid VAT ID or OIB', 'A VAT ID that passes the check digit (and VIES, when checked), or a valid OIB (BT-48). Only for companies in the EU: a row with a VAT ID, OIB, registration number or a legal form (d.o.o., s.p., obrt, GmbH…) in its name; private persons are not asked for one.'],
    ['street', 'Street and number', 'The street address (BT-50).'],
    ['postal', 'Postal code', 'A postal code in the right form that exists in the official list (BT-53).'],
    ['city', 'City matching the code', 'The city, and for Slovenia and Croatia one that belongs to the postal code (BT-52).'],
    ['country', 'Country', 'A recognised country (BT-55). Counted only when the file has a country column.'],
    ['email', 'E-mail for invoices', 'A single valid address to send invoices to (stands in for the electronic address BT-49).'],
    ['iban', 'IBAN', 'A valid IBAN. Counted for suppliers, and for customers when the file has an IBAN column.']
  ];
  var ORG_WORDS = setOf('zavod drustvo klub zadruga obcina ustanova udruga zbornica sola fakulteta bolnisnica dom hotel obrt');
  var EINV_BAD = {
    name: setOf('text.mojibake text.lost text.placeholder'), taxid: setOf('vat.format vat.checksum vat.vies vat.country'), oib: setOf('oib.invalid'),
    street: setOf('text.mojibake text.lost ws.newline text.placeholder'), postal: setOf('postal.format postal.unknown postal.zero'), city: setOf('postal.city text.mojibake'),
    country: setOf('country.unknown'), email: setOf('email.invalid email.typo email.multi email.clean'), iban: setOf('iban.format iban.checksum iban.local')
  };
  /** → null for products, else { rows, ready, pct, avg, scores (0–100 per row), masks (bit i set: criterion EINV[i] not met),
   * crit: [{ id, name, why, n (rows it counts for), miss }] } */
  function einvoice(res, table) {
    if (!res || res.type === 'products') return null;
    var roles = res.roles, nR = res.nRows, col = {};
    ['name', 'vat', 'oib', 'regno', 'street', 'postal', 'city', 'country', 'email', 'iban'].forEach(function (k) { col[k] = roles.indexOf(k); });
    var crit = EINV.map(function (x) { return { id: x[0], name: x[1], why: x[2], n: 0, miss: 0 }; }), C = {};
    crit.forEach(function (x) { C[x.id] = x; });
    var useCountry = col.country >= 0, useIban = col.iban >= 0 || res.type === 'suppliers';
    var scores = new Uint8Array(nR), masks = new Uint16Array(nR), ready = 0, sum = 0, bit = {};
    EINV.forEach(function (x, i) { bit[x[0]] = 1 << i; });
    for (var r = 0; r < nR; r++) {
      var row = table.rows[r], iss = {}, met = 0, n = 0;
      for (var i = res.rowStart[r]; i < res.rowStart[r + 1]; i++) { var x = res.issues[i]; (iss[x.c] = iss[x.c] || {})[x.k] = 1; if (x.k === 'postal.city') iss.city = 1; }
      var filled = function (c, role) { if (c < 0) return false; var v = core(row[c]); return !!v && !isPlaceholder(v, role); };
      var clean = function (c, bad) { var m = iss[c]; if (!m) return true; for (var k in m) if (bad[k]) return false; return true; };
      var ok = function (k, c, role) { return filled(c, role) && clean(c, EINV_BAD[k]); };
      var cc = res.rowCC[r], eu = VIES_CC[cc === 'GR' ? 'EL' : cc];
      // private persons are not asked for a tax ID: a row counts as a company when it has a VAT ID, OIB or registration number,
      // or a legal form or institution word in its name
      var company = filled(col.vat, 'vat') || filled(col.oib, 'oib') || filled(col.regno, 'regno') || (col.name >= 0 && fold(row[col.name]).replace(/[^a-z0-9]+/g, ' ').split(' ').some(function (w) { return LEGAL_TOKENS[w] || ORG_WORDS[w]; }) ) || /\b[a-z]\.\s?[a-z]\.(\s?[a-z]\.)?/i.test(col.name >= 0 ? str(row[col.name]) : '');
      var st = {
        name: ok('name', col.name, 'name'),
        taxid: eu && company ? ok('taxid', col.vat, 'vat') || ok('oib', col.oib, 'oib') : null,
        street: ok('street', col.street, 'street'),
        postal: ok('postal', col.postal, 'postal'),
        city: (filled(col.city, 'city') || (col.postal >= 0 && /^\S+\s+\D/.test(core(row[col.postal])))) && !iss.city,
        country: useCountry ? ok('country', col.country, 'country') : null,
        email: ok('email', col.email, 'email'),
        iban: useIban ? ok('iban', col.iban, 'iban') : null
      };
      for (var k in st) { if (st[k] === null) continue; n++; C[k].n++; if (st[k]) met++; else { C[k].miss++; masks[r] |= bit[k]; } }
      var sc = n ? Math.round(100 * met / n) : 100;
      scores[r] = sc; sum += sc; if (met === n) ready++;
    }
    return { rows: nR, ready: ready, pct: nR ? Math.round(100 * ready / nR) : 100, avg: nR ? Math.round(sum / nR) : 100, scores: scores, masks: masks,
      crit: crit.filter(function (x) { return x.n > 0; }) };
  }

  // ── recipes: the same mapping and fixes on next month's file ───────────
  /** a recipe from an open check: its type, the role of each column (by header), the chosen fixes and duplicate settings */
  function makeRecipe(name, type, data, rules) {
    return { name: str(name).trim().slice(0, 80) || 'Recipe', type: type, createdAt: new Date().toISOString(),
      cols: data.headers.map(function (h, c) { return { h: h, role: data.roles[c] }; }),
      rules: (rules || []).filter(function (k) { return RULES[k] && RULES[k].fix; }), unitTarget: data.unitTarget || null, dupThreshold: data.dupThreshold || null };
  }
  /** how well a recipe fits a file's headers: { found, total, share, roles: role per header or null } (headers compared without
   * capitals, accents and punctuation) */
  function matchRecipe(recipe, headers) {
    var by = {}, found = 0;
    (recipe.cols || []).forEach(function (x) { var k = headerKey(x.h); if (k && !by[k]) by[k] = x.role; });
    var roles = headers.map(function (h) { var role = by[headerKey(h)]; if (role && ROLE[role]) { found++; return role; } return null; });
    var total = (recipe.cols || []).length;
    return { found: found, total: total, share: total ? found / Math.max(total, headers.length) : 0, roles: roles };
  }

  return {
    // text
    fold: fold, core: core, titleCase: titleCase, isCaps: isCaps, fixMojibake: fixMojibake, toMojibake: toMojibake, isPlaceholder: isPlaceholder,
    fixTrim: fixTrim, fixDouble: fixDouble, fixNbsp: fixNbsp, fixBreaks: fixBreaks,
    // files
    ENCODINGS: ENCODINGS, decode: decode, encodeCp1250: encodeCp1250, DELIMS: DELIMS, delimName: delimName, sniffDelimiter: sniffDelimiter,
    csvJob: csvJob, parseCsv: parseCsv, detectHeader: detectHeader, buildTable: buildTable, readText: readText, toCsv: toCsv, headerRole: headerRole,
    // validators
    siTaxOk: siTaxOk, siTaxCheckDigit: siTaxCheckDigit, oibOk: oibOk, oibCheckDigit: oibCheckDigit, vatCheck: vatCheck, VAT_RE: VAT_RE,
    ibanCheck: ibanCheck, ibanCheckDigits: ibanCheckDigits, ibanMod: ibanMod, IBAN_LEN: IBAN_LEN, bicCheck: bicCheck, emailCheck: emailCheck,
    phoneCheck: phoneCheck, postalCheck: postalCheck, postOffice: postOffice, cityMatches: cityMatches, POST: POST, POST_MAIN: POST_MAIN, POST_FULL: POST_FULL, cityKey: cityKey, countryOf: countryOf, ISO2: ISO2,
    COUNTRY_NAME: COUNTRY_NAME, gtinCheckDigit: gtinCheckDigit, gtinOk: gtinOk, eanCheck: eanCheck, parseNumber: parseNumber, plainNumber: plainNumber,
    parseDate: parseDate, formatDate: formatDate, excelSerialToIso: excelSerialToIso, unitGroup: unitGroup, isIso: isIso, addDays: addDays,
    // similarity
    nameTokens: nameTokens, jaro: jaro, jaroWinkler: jaroWinkler, tokenSetSim: tokenSetSim, levSim: levSim, nameSim: function (a, b) {
      var ta = nameTokens(a), tb = nameTokens(b); return nameSim({ tokens: ta, compact: ta.join('') }, { tokens: tb, compact: tb.join('') });
    },
    // roles, rules, analysis
    ROLES: ROLES, ROLE: ROLE, TYPES: TYPES, TYPE: TYPE, DEFAULT_REQ: DEFAULT_REQ, VAT_RATES: VAT_RATES, RULES: RULES, RULE_LIST: RULE_LIST.map(function (x) { return x[0]; }),
    GROUPS: GROUPS, SEV_W: SEV_W, guessRoles: guessRoles, guessType: guessType, rolesForType: rolesForType, autoSetup: autoSetup, contentRole: contentRole,
    MIN_PAIR: MIN_PAIR, analysisJob: analysisJob, analyze: analyze, applyDupes: applyDupes, clusters: clusters, scores: scores, scoreBand: scoreBand, message: message,
    mergeRow: mergeRow, pattern: pattern,
    // fix everything, VIES, e-invoice readiness, recipes
    planFixes: planFixes, fixAll: fixAll, VIES_CC: VIES_CC, viesCandidates: viesCandidates, EINV: EINV, einvoice: einvoice,
    makeRecipe: makeRecipe, matchRecipe: matchRecipe, headerKey: headerKey, specialKind: specialKind
  };
});
