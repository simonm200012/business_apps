/* Budget vs actual: read the first sheet of an Excel file (.xlsx) as text, so an export from Minimax or Pantheon can be
 * dropped in without saving it as CSV first. No network, no dependencies: the ZIP is read by hand and deflated entries
 * go through the browser's DecompressionStream; the XML is read with regular expressions (it is machine-written).
 * BudgetXlsx.toText(arrayBuffer) → Promise<string>: tab-separated rows; numbers with a decimal comma, cells in a date
 * format as 30.09.2026. UMD, so the tests can load it in Node (18+). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  /** name → { method, bytes } from the ZIP's central directory */
  function entries(b) {
    var e = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This is not an Excel file (.xlsx).');
    var n = u16(b, e + 10), p = u32(b, e + 16), out = {}, dec = new TextDecoder();
    for (var k = 0; k < n; k++) {
      if (u32(b, p) !== 0x02014b50) break;
      var method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), lo = u32(b, p + 42);
      var name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      var start = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28);
      out[name] = { method: method, bytes: b.subarray(start, start + csize) };
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  function inflate(en) {
    if (!en) return Promise.resolve('');
    if (en.method === 0) return Promise.resolve(new TextDecoder().decode(en.bytes));
    if (en.method !== 8 || typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This Excel file cannot be read in this browser. Save it as CSV and try again.'));
    var stream = new Blob([en.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }
  function unxml(s) {
    return String(s).replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, function (m, e, d, h) {
      if (d) return String.fromCharCode(+d);
      if (h) return String.fromCharCode(parseInt(h, 16));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }
  function texts(xml) { var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m; while ((m = re.exec(xml))) out += unxml(m[1]); return out; }
  function shared(xml) { var out = [], re = /<si>([\s\S]*?)<\/si>/g, m; while ((m = re.exec(xml || ''))) out.push(texts(m[1])); return out; }
  /** style index → true when the cell's number format is a date */
  function dateStyles(xml) {
    xml = xml || '';
    var custom = {}, re = /<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g, m;
    while ((m = re.exec(xml))) custom[m[1]] = unxml(m[2]);
    var xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml), out = [];
    if (!xfs) return out;
    var rx = /<xf\s([^>]*?)\/?>/g;
    while ((m = rx.exec(xfs[1]))) {
      var id = +((/numFmtId="(\d+)"/.exec(m[1]) || [])[1] || 0), code = custom[id];
      out.push((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (!!code && /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ''))));
    }
    return out;
  }
  function colIndex(ref) { var s = /^[A-Z]+/.exec(ref || ''), n = 0; if (!s) return -1; for (var i = 0; i < s[0].length; i++) n = n * 26 + s[0].charCodeAt(i) - 64; return n - 1; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateText(v) { var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000); return pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear(); }
  function numText(v) {
    var x = +v;
    if (!isFinite(x)) return String(v);
    var s = /e|\.\d{3,}/i.test(String(v)) ? String(Math.round(x * 100) / 100) : String(v);
    return s.replace('.', ',');
  }
  /** rows of strings from a worksheet's XML */
  function sheetRows(xml, ss, ds) {
    var rows = [], rr = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g, m;
    while ((m = rr.exec(xml))) {
      var row = [], cr = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, c, k = 0;
      while ((c = cr.exec(m[1] || ''))) {
        var at = c[1], body = c[2] || '', ref = (/\br="([A-Z]+\d+)"/.exec(at) || [])[1], t = (/\bt="(\w+)"/.exec(at) || [])[1], st = +((/\bs="(\d+)"/.exec(at) || [])[1] || 0);
        var idx = ref ? colIndex(ref) : k, v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1], val = '';
        if (t === 's') val = ss[+v] || '';
        else if (t === 'inlineStr') val = texts(body);
        else if (t === 'str' || t === 'e') val = unxml(v || '');
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) val = ds[st] && +v > 0 ? dateText(+v) : numText(v);
        while (row.length < idx) row.push('');
        row[idx] = val; k = idx + 1;
      }
      rows.push(row);
    }
    return rows;
  }
  function cell(v) { v = String(v == null ? '' : v); return /[\t\r\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toText(buf) {
    var b = new Uint8Array(buf), z;
    try { z = entries(b); } catch (e) { return Promise.reject(e); }
    var sheets = Object.keys(z).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort(function (a, c) { return +/\d+/.exec(a)[0] - +/\d+/.exec(c)[0]; });
    if (!sheets.length) return Promise.reject(new Error('The Excel file has no sheet.'));
    return Promise.all([inflate(z['xl/sharedStrings.xml']), inflate(z['xl/styles.xml']), inflate(z[sheets[0]])]).then(function (x) {
      return sheetRows(x[2], shared(x[0]), dateStyles(x[1])).map(function (r) { return r.map(cell).join('\t'); }).join('\n');
    });
  }
  /** true when the bytes start like a ZIP file (an .xlsx) */
  function isZip(buf) { var b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength)); return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4; }

  return { toText: toText, isZip: isZip, sheetRows: sheetRows, dateStyles: dateStyles, shared: shared };
});
