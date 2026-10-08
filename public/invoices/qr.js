/* InvoiceQR: ISO/IEC 18004 QR encoder (byte mode, optional ECI) + UPN QR and EPC (SEPA) payloads, SVG output. Also runs in Node. */
(function (root) {
  'use strict';
  var ECC = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]];
  var BLK = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]];
  var LV = { L: 0, M: 1, Q: 2, H: 3 }, FMT = { L: 1, M: 0, Q: 3, H: 2 };
  function rawModules(v) { var r = (16 * v + 128) * v + 64; if (v >= 2) { var a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; } return r; }
  function dataCw(v, l) { return Math.floor(rawModules(v) / 8) - ECC[l][v] * BLK[l][v]; }
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function rsGen(deg) {
    var g = [1];
    for (var i = 0; i < deg; i++) { var n = new Array(g.length + 1).fill(0); for (var j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= gmul(g[j], EXP[i]); } g = n; }
    return g;
  }
  function rsRem(data, gen) {
    var res = new Array(gen.length - 1).fill(0);
    data.forEach(function (b) { var f = b ^ res.shift(); res.push(0); for (var i = 0; i < res.length; i++) res[i] ^= gmul(gen[i + 1], f); });
    return res;
  }
  function utf8(s) { return Array.from(new TextEncoder().encode(s)); }
  function penalty(m, size) {
    var p = 0, i, j, dark = 0;
    for (var pass = 0; pass < 2; pass++) {
      for (i = 0; i < size; i++) {
        var run = 1, line = '';
        for (j = 0; j < size; j++) {
          var c = pass ? m[j][i] : m[i][j]; line += c ? '1' : '0';
          if (j > 0) { var pv = pass ? m[j - 1][i] : m[i][j - 1]; if (pv === c) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
        }
        for (j = 0; j + 11 <= size; j++) { var w = line.substr(j, 11); if (w === '10111010000' || w === '00001011101') p += 40; }
      }
    }
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) {
      if (m[i][j]) dark++;
      if (i + 1 < size && j + 1 < size && m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1]) p += 3;
    }
    var tot = size * size; p += (Math.ceil(Math.abs(dark * 20 - tot * 10) / tot) - 1) * 10;
    return p;
  }
  var MASKS = [function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; }, function (x, y) { return x % 3 === 0; }, function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; }, function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; }, function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }];

  /* encode(textOrBytes, { ecc:'M', minVer:1, maxVer:40, eci:null|n, mask:-1 }) -> { version, size, mask, modules:[[bool]] } */
  function encode(input, o) {
    o = o || {};
    var l = LV[o.ecc || 'M'], bytes = typeof input === 'string' ? utf8(input) : Array.from(input);
    var minV = o.minVer || 1, maxV = o.maxVer || 40, ver, i, j;
    for (ver = minV; ; ver++) {
      var need = (o.eci != null ? 12 : 0) + 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCw(ver, l) * 8) break;
      if (ver >= maxV) throw new Error('Text too long for a QR code.');
    }
    var bits = [];
    function put(v, n) { for (var k = n - 1; k >= 0; k--) bits.push((v >>> k) & 1); }
    if (o.eci != null) { put(7, 4); put(o.eci, 8); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCw(ver, l) * 8;
    put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    var data = []; for (i = 0; i < bits.length; i += 8) { var by = 0; for (j = 0; j < 8; j++) by = by << 1 | bits[i + j]; data.push(by); }
    for (var pad = 0xEC; data.length < dataCw(ver, l); pad ^= 0xEC ^ 0x11) data.push(pad);
    // blocks + Reed-Solomon + interleave
    var nb = BLK[l][ver], el = ECC[l][ver], raw = Math.floor(rawModules(ver) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), gen = rsGen(el), blocks = [], k = 0;
    for (i = 0; i < nb; i++) {
      var dl = shortLen - el + (i < nShort ? 0 : 1), dat = data.slice(k, k + dl); k += dl;
      var ecc = rsRem(dat, gen); if (i < nShort) dat.push(0); blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++) for (j = 0; j < nb; j++) if (i !== shortLen - el || j >= nShort) all.push(blocks[j][i]);
    // matrix
    var size = ver * 4 + 17, m = [], fn = [];
    for (i = 0; i < size; i++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function set(x, y, v) { m[y][x] = !!v; fn[y][x] = true; }
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    function finder(cx, cy) { for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) { var d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var pos = [];
    if (ver > 1) { var na = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2; pos = [6]; for (var pp = size - 7; pos.length < na; pp -= step) pos.splice(1, 0, pp); }
    pos.forEach(function (a, ai) { pos.forEach(function (b, bi) {
      if ((ai === 0 && bi === 0) || (ai === 0 && bi === pos.length - 1) || (ai === pos.length - 1 && bi === 0)) return;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }); });
    function format(mask) {
      var d = FMT[o.ecc || 'M'] << 3 | mask, r = d, q; for (q = 0; q < 10; q++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var b = (d << 10 | r) ^ 0x5412; function bit(n) { return ((b >>> n) & 1) !== 0; }
      for (q = 0; q <= 5; q++) set(8, q, bit(q)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8)); for (q = 9; q < 15; q++) set(14 - q, 8, bit(q));
      for (q = 0; q < 8; q++) set(size - 1 - q, 8, bit(q)); for (q = 8; q < 15; q++) set(8, size - 15 + q, bit(q)); set(8, size - 8, true);
    }
    format(0);
    if (ver >= 7) { var rr = ver, q2; for (q2 = 0; q2 < 12; q2++) rr = (rr << 1) ^ ((rr >>> 11) * 0x1F25); var vb = ver << 12 | rr; for (q2 = 0; q2 < 18; q2++) { var c = ((vb >>> q2) & 1) !== 0, a = size - 11 + q2 % 3, b2 = Math.floor(q2 / 3); set(a, b2, c); set(b2, a, c); } }
    var bi2 = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bi2 < all.length * 8) { m[y][x] = ((all[bi2 >>> 3] >>> (7 - (bi2 & 7))) & 1) !== 0; bi2++; }
      }
    }
    function applyMask(mk) { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && MASKS[mk](x, y)) m[y][x] = !m[y][x]; }
    var best = o.mask != null && o.mask >= 0 ? o.mask : -1;
    if (best < 0) { var bp = Infinity; for (var mk = 0; mk < 8; mk++) { applyMask(mk); format(mk); var pn = penalty(m, size); if (pn < bp) { bp = pn; best = mk; } applyMask(mk); } }
    applyMask(best); format(best);
    return { version: ver, size: size, mask: best, modules: m };
  }

  /* ISO 8859-2 (Latin-2) */
  var L2 = ' Ą˘Ł¤ĽŚ§¨ŠŞŤŹ­ŽŻ°ą˛ł´ľśˇ¸šşťź˝žżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙';
  function latin2(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0xA0) out.push(c); else { var k = L2.indexOf(s[i]); out.push(k >= 0 ? 0xA0 + k : 63); } }
    return out;
  }
  function fit(s, n) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n); }
  function cents(a) { return Math.round(Math.abs(Number(a) || 0) * 100); }
  function ddmmyyyy(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; }
  function refOk(r) { return /^(SI|RF)\d\d/i.test(r || ''); }
  /* o: { amount, purposeCode, purpose, due (ISO), iban, reference, name, street, city } */
  function upnPayload(o) {
    var iban = String(o.iban || '').replace(/\s+/g, '').toUpperCase();
    var ref = String(o.reference || '').replace(/\s+/g, '').toUpperCase();
    var f = ['UPNQR', '', '', '', '', '', '', '', String(cents(o.amount)).padStart(11, '0'), '', '', fit(o.purposeCode || 'OTHR', 4).toUpperCase(), fit(o.purpose, 42), ddmmyyyy(o.due),
      iban, refOk(ref) ? fit(ref, 26) : 'SI99', fit(o.name, 33), fit(o.street, 33), fit(o.city, 33)];
    var body = f.join('\n') + '\n', ctl = String(latin2(body).length).padStart(3, '0');
    var bytes = latin2(body + ctl + '\n'); while (bytes.length < 411) bytes.push(32);
    return { text: body + ctl + '\n', bytes: bytes.slice(0, 411) };
  }
  function upnQr(o) { var p = upnPayload(o); var q = encode(p.bytes, { ecc: 'M', minVer: 15, maxVer: 15, eci: 4 }); q.payload = p.text; return q; }
  /* o: { bic, name, iban, amount, purpose, reference, text } */
  function epcPayload(o) {
    var ref = String(o.reference || '').replace(/\s+/g, '').toUpperCase(), structured = /^RF\d\d[A-Z0-9]{1,21}$/.test(ref);
    var lines = ['BCD', '002', '1', 'SCT', fit(o.bic, 11), fit(o.name, 70), String(o.iban || '').replace(/\s+/g, '').toUpperCase(), 'EUR' + (cents(o.amount) / 100).toFixed(2),
      fit(o.purposeCode, 4), structured ? ref : '', structured ? '' : fit(o.text || o.purpose, 140)];
    while (lines.length > 7 && !lines[lines.length - 1]) lines.pop();
    return lines.join('\n');
  }
  function epcQr(o) { var t = epcPayload(o), q = encode(t, { ecc: 'M', minVer: 1, maxVer: 13 }); q.payload = t; return q; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function svg(q, o) {
    o = o || {}; var quiet = o.quiet == null ? 4 : o.quiet, n = q.size + quiet * 2, d = '';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) {
      var e = x; while (e < q.size && q.modules[y][e]) e++;
      d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h' + (e - x) + 'v1h-' + (e - x) + 'z'; x = e;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' + esc(o.title || 'QR code') + '"' + (o.px ? ' width="' + (+o.px) + '" height="' + (+o.px) + '"' : '') + '><title>' + esc(o.title || 'QR code') + '</title><rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  var api = { encode: encode, svg: svg, upnPayload: upnPayload, upnQr: upnQr, epcPayload: epcPayload, epcQr: epcQr, latin2: latin2, dataCodewords: dataCw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.InvoiceQR = api;
})(typeof window !== 'undefined' ? window : globalThis);
