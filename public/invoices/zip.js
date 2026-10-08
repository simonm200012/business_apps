/* InvoiceZip: minimal ZIP writer (stored) and reader (stored + deflate via DecompressionStream). Also runs in Node. */
(function (root) {
  'use strict';
  var enc = new TextEncoder(), dec = new TextDecoder('utf-8');
  var TABLE = null;
  function crc32(u8) {
    if (!TABLE) { TABLE = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = TABLE[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function toU8(d) {
    if (typeof d === 'string') return enc.encode(d);
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (d && d.buffer) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return new Uint8Array(0);
  }
  function dos(date) {
    var d = date || new Date();
    return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  /* entries: [{ name, data: string|Uint8Array|ArrayBuffer, date? }] -> Uint8Array (method 0, stored) */
  function write(entries) {
    var parts = [], central = [], offset = 0;
    entries.forEach(function (e) {
      var name = enc.encode(String(e.name).replace(/^\/+/, '')), data = toU8(e.data), crc = crc32(data), t = dos(e.date);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, t.t, true); lh.setUint16(12, t.d, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, t.t, true); ch.setUint16(14, t.d, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]), total = all.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }
  /* Same as write() but entries may hold Blobs; resolves to a Blob. */
  async function build(entries) {
    var list = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], d = e.data;
      if (d && typeof d.arrayBuffer === 'function') d = new Uint8Array(await d.arrayBuffer());
      list.push({ name: e.name, data: d, date: e.date });
    }
    return new Blob([write(list)], { type: 'application/zip' });
  }
  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed ZIP files.');
    var s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  /* -> Promise<[{ name, data: Uint8Array, size }]> for stored and deflate entries */
  async function read(buf) {
    var u8 = toU8(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a ZIP file.');
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), out = [];
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged ZIP directory.');
      var flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      var nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (/\/$/.test(name)) continue;
      var ln = dv.getUint16(lo + 26, true), le = dv.getUint16(lo + 28, true), start = lo + 30 + ln + le;
      var raw = u8.subarray(start, start + csize), data;
      if (method === 0) data = raw.slice(); else if (method === 8) data = await inflate(raw); else throw new Error('Unsupported ZIP method ' + method + '.');
      out.push({ name: name, data: data, size: data.length });
    }
    return out;
  }
  var api = { crc32: crc32, write: write, build: build, read: read, text: function (e) { return dec.decode(e.data); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.InvoiceZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
