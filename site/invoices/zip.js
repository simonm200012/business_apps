/* Minimal ZIP writer and reader for Adrial Apps · Invoices — no network, no dependencies.
 *
 * InvoiceZip.make([{ name, data: Blob | Uint8Array | ArrayBuffer | string, date? }]) → Promise<Blob>
 *   Entries are stored (no compression; PDFs and photos are compressed already) with UTF-8 names.
 * InvoiceZip.read(blob) → Promise<{ names: [...], file(name) → entry | null }>
 *   entry.async('string' | 'arraybuffer' | 'blob'). Reads stored and deflated entries (deflate via
 *   the browser's DecompressionStream), which covers backups made by earlier versions (JSZip).
 */
(function (root) {
  'use strict';

  var TABLE = null;
  function crcTable() {
    if (TABLE) return TABLE;
    TABLE = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
    return TABLE;
  }
  function crc32(u8) {
    var t = crcTable();
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function toBytes(data) {
    if (data == null) return Promise.resolve(new Uint8Array(0));
    if (typeof data === 'string') return Promise.resolve(new TextEncoder().encode(data));
    if (data instanceof Uint8Array) return Promise.resolve(data);
    if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
    if (data && typeof data.arrayBuffer === 'function') return data.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return Promise.reject(new Error('Unsupported ZIP entry data'));
  }

  function dos(d) {
    d = d instanceof Date && !isNaN(d) ? d : new Date();
    var year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  async function make(entries) {
    var parts = [];
    var central = [];
    var offset = 0;
    var used = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var name = String(e.name || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
      // never two entries with the same name
      var base = name;
      var n = 2;
      while (used[name.toLowerCase()]) {
        var dot = base.lastIndexOf('.');
        name = dot > base.lastIndexOf('/') ? base.slice(0, dot) + '-' + n + base.slice(dot) : base + '-' + n;
        n++;
      }
      used[name.toLowerCase()] = true;
      var nameBytes = new TextEncoder().encode(name);
      var data = await toBytes(e.data);
      var crc = crc32(data);
      var t = dos(e.date);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true); // UTF-8 names
      lh.setUint16(8, 0, true);      // stored
      lh.setUint16(10, t.time, true);
      lh.setUint16(12, t.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);
      parts.push(lh.buffer, nameBytes, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, t.time, true);
      ch.setUint16(14, t.date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    var cdSize = central.reduce(function (s, p) { return s + (p.byteLength != null ? p.byteLength : p.length); }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack compressed ZIP files');
    var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function read(blob) {
    var buf = new Uint8Array(await blob.arrayBuffer());
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var eocd = -1;
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('this is not a ZIP file');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var map = {};
    var names = [];
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('the ZIP file is damaged');
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true);
      var xlen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      (function (method, csize, local, name) {
        var entry = {
          name: name,
          bytes: function () {
            var ln = dv.getUint16(local + 26, true);
            var lx = dv.getUint16(local + 28, true);
            var start = local + 30 + ln + lx;
            var raw = buf.subarray(start, start + csize);
            if (method === 0) return Promise.resolve(raw);
            if (method === 8) return inflateRaw(raw);
            return Promise.reject(new Error('unsupported ZIP compression'));
          },
          async: function (kind) {
            return entry.bytes().then(function (b) {
              if (kind === 'string') return new TextDecoder().decode(b);
              if (kind === 'blob') return new Blob([b]);
              return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
            });
          }
        };
        if (name.slice(-1) !== '/') { map[name] = entry; names.push(name); }
      })(method, csize, local, name);
    }
    return { names: names, file: function (name) { return map[name] || null; } };
  }

  var api = { make: make, read: read, crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceZip = api;
})(typeof window !== 'undefined' ? window : this);
