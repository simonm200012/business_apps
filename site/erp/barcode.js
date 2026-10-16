/* Tokovi ERP · barcodes. No network, no dependencies.
 *
 *   ERPBarcode.check(body)        → GS1 check digit for 7 / 11 / 12 digits (EAN-8, UPC-A, EAN-13)
 *   ERPBarcode.valid(code)        → true for an EAN-13, EAN-8 or UPC-A (12 digits) with a correct check digit
 *   ERPBarcode.normalize(text)    → the digits of a typed / scanned code ("4 006381 333931" → "4006381333931"); UPC-A is
 *                                   returned as EAN-13 (leading 0), so one product number matches both
 *   ERPBarcode.svg(code, opts)    → SVG markup of an EAN-13 / EAN-8 symbol with the digits under it
 *   ERPBarcode.decodeRow(lum)     → code or null: one line of luminance values (0–255) across the bars
 *   ERPBarcode.decodeImage(img)   → { code, hits } or null: RGBA ImageData ({ data, width, height }); reads several rows
 *                                   in both directions (a phone held upside down), hits = rows that agree
 *
 * The decoder is for browsers without the BarcodeDetector API (Safari on iPhone): it binarises each row against a local
 * threshold, turns it into bar/space widths and matches the EAN symbol structure (guard bars, 7-module digits in L/G/R
 * sets, the parity pattern that encodes the 13th digit; GS1 General Specifications §5.2) and the check digit (§7.9). */
(function (root) {
  'use strict';

  // L-set (odd parity) patterns; the R set is their complement, the G set the R set reversed.
  var L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  var R = L.map(function (p) { return p.replace(/./g, function (c) { return c === '0' ? '1' : '0'; }); });
  var G = R.map(function (p) { return p.split('').reverse().join(''); });
  // parity of the six left digits for each leading digit (L = 0, G = 1)
  var PARITY = ['000000', '001011', '001101', '001110', '010011', '011001', '011100', '010101', '010110', '011010'];
  function runsOf(bits) { var out = [], n = 1; for (var i = 1; i <= bits.length; i++) { if (bits[i] === bits[i - 1]) n++; else { out.push(n); n = 1; } } return out; }
  var LW = L.map(runsOf), GW = G.map(runsOf); // widths [space, bar, space, bar]; R digits have the L widths as [bar, space, bar, space]

  function check(body) {
    var d = String(body), s = 0;
    for (var i = 0; i < d.length; i++) s += (+d[d.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
    return (10 - s % 10) % 10;
  }
  function valid(code) {
    var c = String(code == null ? '' : code);
    if (!/^(\d{8}|\d{12}|\d{13})$/.test(c)) return false;
    return check(c.slice(0, -1)) === +c[c.length - 1];
  }
  function normalize(text) {
    var c = String(text == null ? '' : text).replace(/[\s-]/g, '');
    if (!/^\d+$/.test(c)) return null;
    if (c.length === 12) c = '0' + c;
    return c.length === 13 || c.length === 8 ? c : null;
  }

  // ── symbol → modules ────────────────────────────────────────────────────
  function modules(code) {
    var c = String(code);
    if (c.length === 13) {
      var par = PARITY[+c[0]], m = '101';
      for (var i = 1; i <= 6; i++) m += (par[i - 1] === '1' ? G : L)[+c[i]];
      m += '01010';
      for (var j = 7; j <= 12; j++) m += R[+c[j]];
      return m + '101';
    }
    if (c.length === 8) {
      var m8 = '101';
      for (var k = 0; k < 4; k++) m8 += L[+c[k]];
      m8 += '01010';
      for (var q = 4; q < 8; q++) m8 += R[+c[q]];
      return m8 + '101';
    }
    throw new Error('EAN-13 or EAN-8 expected');
  }

  function svg(code, opts) {
    opts = opts || {};
    var c = normalize(code);
    if (!c || !valid(c)) return '';
    var m = modules(c), qz = c.length === 13 ? 11 : 7, w = m.length + qz + 7, h = opts.height || 56, d = '';
    var guards = c.length === 13 ? [0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94] : [0, 1, 2, 31, 32, 33, 34, 35, 64, 65, 66];
    for (var i = 0; i < m.length; i++) {
      if (m[i] !== '1') continue;
      var s = i;
      while (i + 1 < m.length && m[i + 1] === '1' && (guards.indexOf(i + 1) >= 0) === (guards.indexOf(s) >= 0)) i++;
      d += 'M' + (s + qz) + ' 0h' + (i - s + 1) + 'v' + (guards.indexOf(s) >= 0 ? h + 5 : h) + 'h-' + (i - s + 1) + 'z';
    }
    var t = '', y = h + 11, fs = 'font-family="ui-monospace,Menlo,monospace" font-size="9" text-anchor="middle"';
    if (c.length === 13) {
      t = '<text x="' + (qz - 4) + '" y="' + y + '" ' + fs + '>' + c[0] + '</text>' +
        '<text x="' + (qz + 24) + '" y="' + y + '" ' + fs + ' letter-spacing="1.6">' + c.slice(1, 7) + '</text>' +
        '<text x="' + (qz + 70) + '" y="' + y + '" ' + fs + ' letter-spacing="1.6">' + c.slice(7) + '</text>';
    } else {
      t = '<text x="' + (qz + 17) + '" y="' + y + '" ' + fs + ' letter-spacing="1.6">' + c.slice(0, 4) + '</text>' +
        '<text x="' + (qz + 50) + '" y="' + y + '" ' + fs + ' letter-spacing="1.6">' + c.slice(4) + '</text>';
    }
    var title = String(opts.title || 'Barcode ' + c).replace(/[&<>"']/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]; });
    return '<svg class="ean" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + (h + 14) + '" role="img" aria-label="' + title + '" shape-rendering="crispEdges">' +
      '<rect width="' + w + '" height="' + (h + 14) + '" fill="#fff"/><path d="' + d + '" fill="#000"/><g fill="#000">' + t + '</g></svg>';
  }

  // ── decoding ─────────────────────────────────────────────────────────────
  // one row → [first colour (1 = dark), widths…], against a local threshold (lighting changes across a photo)
  function toRuns(lum) {
    var n = lum.length, rad = Math.max(6, Math.round(n / 28)), out = [], cur = -1, w = 0;
    // prefix sums for the local mean; local min/max over the same window decide whether there is any contrast at all
    var ps = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) ps[i + 1] = ps[i] + lum[i];
    var gmin = 255, gmax = 0;
    for (var g = 0; g < n; g++) { if (lum[g] < gmin) gmin = lum[g]; if (lum[g] > gmax) gmax = lum[g]; }
    if (gmax - gmin < 40) return null;
    var minC = (gmax - gmin) * 0.18;
    for (var x = 0; x < n; x++) {
      var a = Math.max(0, x - rad), b = Math.min(n, x + rad + 1), mean = (ps[b] - ps[a]) / (b - a);
      var lo = 255, hi = 0;
      for (var k = a; k < b; k += 2) { if (lum[k] < lo) lo = lum[k]; if (lum[k] > hi) hi = lum[k]; }
      var thr = hi - lo < minC ? (gmin + gmax) / 2 : (mean + (lo + hi) / 2) / 2;
      var dark = lum[x] < thr ? 1 : 0;
      if (dark === cur) w++;
      else { if (cur >= 0) out.push(w); else out.first = dark; cur = dark; w = 1; }
    }
    out.push(w);
    return out;
  }
  function matchDigit(rw, sets) { // rw: 4 widths → { d, set } of the closest pattern, or null
    var t = rw[0] + rw[1] + rw[2] + rw[3], best = null, bd = 9;
    for (var s = 0; s < sets.length; s++) {
      for (var d = 0; d < 10; d++) {
        var p = sets[s][d], dist = 0;
        for (var j = 0; j < 4; j++) dist += Math.abs(rw[j] * 7 / t - p[j]);
        if (dist < bd) { bd = dist; best = { d: d, set: s }; }
      }
    }
    return bd <= 1.6 ? best : null;
  }
  function near(w, m, n) { return w >= m * n * 0.45 && w <= m * n * 1.9 + 1; }
  function tryAt(runs, i, kind) { // runs[i] is a dark run (start guard)
    var count = kind === 13 ? 59 : 43, mods = kind === 13 ? 95 : 67, half = kind === 13 ? 6 : 4;
    if (i + count > runs.length) return null;
    var W = 0;
    for (var k = 0; k < count; k++) W += runs[i + k];
    var m = W / mods;
    if (m < 0.9) return null;
    if (i > 0 && runs[i - 1] < m * 3) return null;                              // quiet zone before the start guard
    if (i + count < runs.length && runs[i + count] < m * 3) return null;       // …and after the end guard
    for (var g = 0; g < 3; g++) if (!near(runs[i + g], m, 1) || !near(runs[i + count - 1 - g], m, 1)) return null;
    var mid = i + 3 + half * 4;
    for (var q = 0; q < 5; q++) if (!near(runs[mid + q], m, 1)) return null;
    var digits = '', par = '';
    for (var a = 0; a < half; a++) {
      var x = i + 3 + a * 4, hit = matchDigit([runs[x], runs[x + 1], runs[x + 2], runs[x + 3]], kind === 13 ? [LW, GW] : [LW]);
      if (!hit) return null;
      digits += hit.d; par += hit.set;
    }
    for (var b = 0; b < half; b++) {
      var y = mid + 5 + b * 4, hit2 = matchDigit([runs[y], runs[y + 1], runs[y + 2], runs[y + 3]], [LW]);
      if (!hit2) return null;
      digits += hit2.d;
    }
    var code;
    if (kind === 13) { var first = PARITY.indexOf(par); if (first < 0) return null; code = first + digits; }
    else code = digits;
    return valid(code) ? code : null;
  }
  function decodeRuns(runs) {
    if (!runs || runs.length < 45) return null;
    var dark0 = runs.first; // colour of runs[0]
    for (var i = 0; i < runs.length; i++) {
      if (((i % 2 === 0) ? dark0 : 1 - dark0) !== 1) continue;
      var c = tryAt(runs, i, 13) || tryAt(runs, i, 8);
      if (c) return c;
    }
    return null;
  }
  function decodeRow(lum) {
    var arr = Array.prototype.slice.call(lum);
    var c = decodeRuns(toRuns(arr));
    if (c) return c;
    return decodeRuns(toRuns(arr.reverse()));
  }
  function decodeImage(img) {
    if (!img || !img.data || !img.width || !img.height) return null;
    var W = img.width, H = img.height, data = img.data, found = {}, best = null;
    var row = new Uint8Array(W);
    for (var k = -8; k <= 8; k++) {
      var y = Math.round(H / 2 + k * H / 26);
      if (y < 0 || y >= H) continue;
      var o = y * W * 4;
      for (var x = 0; x < W; x++, o += 4) row[x] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
      var c = decodeRow(row);
      if (!c) continue;
      found[c] = (found[c] || 0) + 1;
      if (!best || found[c] > found[best]) best = c;
    }
    return best ? { code: best, hits: found[best] } : null;
  }

  var api = { check: check, valid: valid, normalize: normalize, modules: modules, svg: svg, decodeRow: decodeRow, decodeImage: decodeImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ERPBarcode = api;
})(typeof window !== 'undefined' ? window : this);
