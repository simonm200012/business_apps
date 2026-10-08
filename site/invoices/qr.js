/* QR codes for paying invoices — Adrial Apps · Invoices. No network, no dependencies.
 *
 * InvoiceQR.encode(bytes, { minVersion, maxVersion, eci }) → { size, modules[y][x] }   (error correction M)
 * InvoiceQR.upn(fields) → { text, bytes }   Slovenian UPN QR payload (ZBS spec: 19 fields + control sum,
 *                                            ISO 8859-2, padded to 411 bytes, QR version 15 / M / ECI 4)
 * InvoiceQR.epc(fields) → { text, bytes }   EPC069-12 "BCD" SEPA credit transfer payload (UTF-8)
 * InvoiceQR.svg(qr, { title }) → SVG markup string (only numbers and the escaped title go into it)
 *
 * The encoder follows ISO/IEC 18004 (byte mode, optional ECI header, Reed–Solomon over GF(256),
 * block interleaving, 8 masks with the standard penalty rules).
 */
(function (root) {
  'use strict';

  // error correction level M: [EC codewords per block, number of blocks] for versions 1–40
  var ECC_M = [null,
    [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5],
    [30, 5], [22, 8], [22, 9], [24, 9], [24, 10], [28, 10], [28, 11], [26, 13], [26, 14], [26, 16],
    [26, 17], [28, 17], [28, 18], [28, 20], [28, 21], [28, 23], [28, 25], [28, 26], [28, 28], [28, 29],
    [28, 31], [28, 33], [28, 35], [28, 37], [28, 38], [28, 40], [28, 43], [28, 45], [28, 47], [28, 49]];
  var FORMAT_M = 0; // format bits for level M

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_M[ver][0] * ECC_M[ver][1]; }

  // ---------- Reed–Solomon ----------
  function gmul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    var r = [];
    for (var i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = gmul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gmul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      for (var i = 0; i < div.length; i++) r[i] ^= gmul(div[i], f);
    });
    return r;
  }

  function alignPositions(ver, size) {
    if (ver === 1) return [];
    var na = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    var out = [6];
    for (var pos = size - 7; out.length < na; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function bitsOf(v, n, out) { for (var i = n - 1; i >= 0; i--) out.push((v >>> i) & 1); }

  function encode(bytes, opts) {
    opts = opts || {};
    var minV = opts.minVersion || 1;
    var maxV = opts.maxVersion || 40;
    var ver = 0;
    var bits;
    for (var v = minV; v <= maxV; v++) {
      bits = [];
      if (opts.eci != null) { bitsOf(7, 4, bits); bitsOf(opts.eci, 8, bits); }
      bitsOf(4, 4, bits);
      bitsOf(bytes.length, v <= 9 ? 8 : 16, bits);
      for (var i = 0; i < bytes.length; i++) bitsOf(bytes[i], 8, bits);
      if (bits.length <= dataCodewords(v) * 8) { ver = v; break; }
    }
    if (!ver) throw new Error('Too much data for a QR code');
    var cap = dataCodewords(ver) * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      data.push(byte);
    }
    for (var pad = 0xEC; data.length < cap / 8; pad ^= 0xEC ^ 0x11) data.push(pad);

    // error correction + interleaving
    var ecLen = ECC_M[ver][0];
    var nBlocks = ECC_M[ver][1];
    var raw = Math.floor(rawModules(ver) / 8);
    var nShort = nBlocks - raw % nBlocks;
    var shortLen = Math.floor(raw / nBlocks);
    var div = rsDivisor(ecLen);
    var blocks = [];
    for (var bi = 0, p = 0; bi < nBlocks; bi++) {
      var len = shortLen - ecLen + (bi < nShort ? 0 : 1);
      var dat = data.slice(p, p + len);
      p += len;
      var ecc = rsRemainder(dat, div);
      if (bi < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var cw = [];
    for (var ci = 0; ci < blocks[0].length; ci++) {
      for (var bj = 0; bj < blocks.length; bj++) {
        if (ci !== shortLen - ecLen || bj >= nShort) cw.push(blocks[bj][ci]);
      }
    }

    // modules
    var size = ver * 4 + 17;
    var M = [];
    var F = [];
    for (var y = 0; y < size; y++) { M.push(new Array(size).fill(false)); F.push(new Array(size).fill(false)); }
    function setF(x, y, dark) { M[y][x] = dark; F[y][x] = true; }
    for (var ti = 0; ti < size; ti++) { setF(6, ti, ti % 2 === 0); setF(ti, 6, ti % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = c[0] + dx, yy = c[1] + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        setF(xx, yy, d !== 2 && d !== 4);
      }
    });
    var al = alignPositions(ver, size);
    al.forEach(function (ay, i) {
      al.forEach(function (ax, j) {
        if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    function drawFormat(mask) {
      var d = (FORMAT_M << 3) | mask;
      var rem = d;
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((d << 10) | rem) ^ 0x5412;
      var bit = function (i) { return ((fb >>> i) & 1) !== 0; };
      for (var a = 0; a <= 5; a++) setF(8, a, bit(a));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (var c = 9; c < 15; c++) setF(14 - c, 8, bit(c));
      for (var e = 0; e < 8; e++) setF(size - 1 - e, 8, bit(e));
      for (var g = 8; g < 15; g++) setF(8, size - 15 + g, bit(g));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var rem = ver;
      for (var vi = 0; vi < 12; vi++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (var q = 0; q < 18; q++) {
        var on = ((vb >>> q) & 1) !== 0;
        var aa = size - 11 + q % 3, bb = Math.floor(q / 3);
        setF(aa, bb, on); setF(bb, aa, on);
      }
    }
    // data in the zig-zag order
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var x = right - jj;
          var up = ((right + 1) & 2) === 0;
          var yy2 = up ? size - 1 - vert : vert;
          if (!F[yy2][x] && idx < cw.length * 8) {
            M[yy2][x] = ((cw[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0;
            idx++;
          }
        }
      }
    }
    var MASKS = [
      function (x, y) { return (x + y) % 2 === 0; },
      function (x, y) { return y % 2 === 0; },
      function (x) { return x % 3 === 0; },
      function (x, y) { return (x + y) % 3 === 0; },
      function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
      function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
    ];
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x];
    }
    function penalty() {
      var s = 0;
      var line = function (get) {
        for (var a = 0; a < size; a++) {
          var run = 1;
          var seq = [];
          for (var b = 0; b < size; b++) seq.push(get(a, b));
          for (var c = 1; c <= size; c++) {
            if (c < size && seq[c] === seq[c - 1]) run++;
            else { if (run >= 5) s += 3 + run - 5; run = 1; }
          }
          var str = seq.map(function (v) { return v ? '1' : '0'; }).join('');
          var re = /(?=(10111010000|00001011101))/g;
          var mm;
          while ((mm = re.exec(str))) { s += 40; re.lastIndex++; }
        }
      };
      line(function (a, b) { return M[a][b]; });
      line(function (a, b) { return M[b][a]; });
      for (var y = 0; y < size - 1; y++) for (var x = 0; x < size - 1; x++) {
        var v = M[y][x];
        if (v === M[y][x + 1] && v === M[y + 1][x] && v === M[y + 1][x + 1]) s += 3;
      }
      var dark = 0;
      for (var y2 = 0; y2 < size; y2++) for (var x2 = 0; x2 < size; x2++) if (M[y2][x2]) dark++;
      var total = size * size;
      s += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return s;
    }
    var best = 0;
    var bestScore = Infinity;
    for (var mk = 0; mk < 8; mk++) {
      applyMask(mk); drawFormat(mk);
      var sc = penalty();
      if (sc < bestScore) { bestScore = sc; best = mk; }
      applyMask(mk);
    }
    applyMask(best); drawFormat(best);
    return { version: ver, size: size, mask: best, modules: M };
  }

  // ---------- text encodings ----------

  var L2 = { 'Č': 0xC8, 'č': 0xE8, 'Š': 0xA9, 'š': 0xB9, 'Ž': 0xAE, 'ž': 0xBE, 'Ć': 0xC6, 'ć': 0xE6, 'Đ': 0xD0, 'đ': 0xF0,
    'Ä': 0xC4, 'ä': 0xE4, 'Ö': 0xD6, 'ö': 0xF6, 'Ü': 0xDC, 'ü': 0xFC, 'ß': 0xDF, 'É': 0xC9, 'é': 0xE9, 'Á': 0xC1, 'á': 0xE1,
    'Í': 0xCD, 'í': 0xED, 'Ó': 0xD3, 'ó': 0xF3, 'Ú': 0xDA, 'ú': 0xFA, 'Ł': 0xA3, 'ł': 0xB3, 'Ř': 0xD8, 'ř': 0xF8, 'Ě': 0xCC, 'ě': 0xEC };
  function latin2(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (L2[ch] != null) out.push(L2[ch]);
      else {
        var plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        out.push(plain.length === 1 && plain.charCodeAt(0) < 0x80 ? plain.charCodeAt(0) : 0x3F);
      }
    }
    return new Uint8Array(out);
  }
  // characters that survive in ISO 8859-2, everything else simplified; no line breaks inside a field
  function clean(s, max) {
    var t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    t = Array.from(t).map(function (ch) {
      if (ch.charCodeAt(0) < 0x80 || L2[ch] != null) return ch;
      var p = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      return p.length === 1 && p.charCodeAt(0) < 0x80 ? p : '?';
    }).join('');
    return t.slice(0, max);
  }
  function ddmmyyyy(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }

  // fields: { iban, amount, reference, name, street, city, purpose, purposeCode, dueDate } (recipient side only;
  // the payer's fields stay empty so the banking app fills in the payer's own account)
  function upn(f) {
    var iban = String(f.iban || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new Error('A valid IBAN is needed');
    var cents = Math.round(Number(f.amount) * 100);
    if (!(cents > 0) || cents > 99999999999) throw new Error('An amount above 0 is needed');
    var ref = String(f.reference || '').replace(/\s/g, '').toUpperCase();
    if (!/^(SI\d{2}[0-9A-Z\-]{0,22}|RF\d{2}[0-9A-Z]{1,21})$/.test(ref)) ref = 'SI99';
    var code = /^[A-Z]{4}$/.test(f.purposeCode || '') ? f.purposeCode : 'OTHR';
    var fields = [
      'UPNQR', '', '', '', '', '', '', '',
      String(cents).padStart(11, '0'),
      '', '',
      code,
      clean(f.purpose, 42),
      ddmmyyyy(f.dueDate),
      iban.slice(0, 34),
      ref.slice(0, 26),
      clean(f.name, 33),
      clean(f.street, 33),
      clean(f.city, 33)
    ];
    var body = fields.join('\n') + '\n';
    var bytesBody = latin2(body);
    var text = body + String(bytesBody.length).padStart(3, '0') + '\n';
    var bytes = latin2(text);
    var padded = new Uint8Array(411);
    padded.fill(0x20);
    padded.set(bytes.subarray(0, 411));
    return { text: text, bytes: padded, fields: fields };
  }

  function epc(f) {
    var iban = String(f.iban || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new Error('A valid IBAN is needed');
    var amount = Math.round(Number(f.amount) * 100) / 100;
    if (!(amount >= 0.01 && amount <= 999999999.99)) throw new Error('An amount above 0 is needed');
    var name = String(f.name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 70);
    if (!name) throw new Error('The vendor name is needed');
    var ref = String(f.reference || '').replace(/\s/g, '').toUpperCase();
    var structured = /^RF\d{2}[0-9A-Z]{1,21}$/.test(ref) ? ref : '';
    var text = String(f.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
    var lines = ['BCD', '002', '1', 'SCT', String(f.bic || '').trim().slice(0, 11), name, iban, 'EUR' + amount.toFixed(2),
      /^[A-Z]{4}$/.test(f.purposeCode || '') ? f.purposeCode : '', structured, structured ? '' : text];
    while (lines.length > 9 && lines[lines.length - 1] === '') lines.pop();
    var out = lines.join('\n');
    return { text: out, bytes: new TextEncoder().encode(out) };
  }

  function svg(qr, opts) {
    opts = opts || {};
    var q = 4;
    var n = qr.size + q * 2;
    var d = '';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          var start = x;
          while (x + 1 < qr.size && qr.modules[y][x + 1]) x++;
          d += 'M' + (start + q) + ' ' + (y + q) + 'h' + (x - start + 1) + 'v1h-' + (x - start + 1) + 'z';
        }
      }
    }
    var title = String(opts.title || 'QR code').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' + title + '">' +
      '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  function upnQr(fields) {
    var p = upn(fields);
    return { payload: p, qr: encode(p.bytes, { minVersion: 15, maxVersion: 15, eci: 4 }) };
  }
  function epcQr(fields) {
    var p = epc(fields);
    return { payload: p, qr: encode(p.bytes, { maxVersion: 13 }) };
  }

  var api = { encode: encode, upn: upn, epc: epc, upnQr: upnQr, epcQr: epcQr, svg: svg, latin2: latin2, dataCodewords: dataCodewords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceQR = api;
})(typeof window !== 'undefined' ? window : this);
