/* Pisarna DMS (Adrial Apps): downloads and ZIP export for the in-browser demo.
 * The original demo switched these off because the claude.ai preview blocks downloads; on our own
 * site they work. The app calls these through small hooks patched into its bundle. */
(function () {
  'use strict';

  function save(data, name) {
    var a = document.createElement('a');
    a.href = typeof data === 'string' ? data : URL.createObjectURL(data);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (typeof data !== 'string') URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // Minimal ZIP writer (stored, no compression; scans are already compressed).
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = -1; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF; }
  function dosDate(d) { return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0, now = new Date();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.bytes, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(10, dosTime(now), true); h.setUint16(12, dosDate(now), true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      parts.push(h, name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, dosTime(now), true); c.setUint16(14, dosDate(now), true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c, name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (a, x) { return a + x.byteLength; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  var clean = function (v) { return String(v == null ? '' : v).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim(); };
  function extOf(page) {
    if (page.name && /\.[a-z0-9]{2,5}$/i.test(page.name)) return '';
    var e = String(page.mime || '').split('/')[1] || 'bin';
    return '.' + (e === 'jpeg' ? 'jpg' : e.replace(/[^a-z0-9]/gi, ''));
  }

  // One file: the stored blob under its original name.
  function downloadBlob(local, id, toast) {
    var url = local.blobUrl(id);
    if (!url) { toast('Datoteke ni mogoče prenesti.'); return; }
    var meta = local.blobMeta ? local.blobMeta(id) : null;
    save(url, (meta && meta.name) || ('dokument-' + id));
  }

  // Several documents: every page of every document in one ZIP.
  async function exportZip(local, ids, call, toast) {
    try {
      toast('Pripravljam ZIP …');
      var files = [], used = {};
      for (var i = 0; i < ids.length; i++) {
        var doc;
        try { doc = await call('getDocument', { id: ids[i] }); } catch (e) { continue; }
        var base = clean(doc.number || doc.docNumber || doc.subject || doc.name || ids[i]) || String(ids[i]);
        var pages = doc.pages || [];
        for (var p = 0; p < pages.length; p++) {
          var url = local.blobUrl(pages[p].blobId);
          if (!url) continue;
          var bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
          var file = pages[p].name ? clean(pages[p].name) + extOf(pages[p]) : base + (pages.length > 1 ? '-' + (p + 1) : '') + extOf(pages[p]);
          var path = (pages.length > 1 ? base + '/' : '') + file, unique = path, n = 2;
          while (used[unique]) unique = path.replace(/(\.[^./]+)?$/, '-' + (n++) + '$1');
          used[unique] = 1;
          files.push({ name: unique, bytes: bytes });
        }
      }
      if (!files.length) { toast('Izbrani dokumenti nimajo datotek.'); return; }
      save(zip(files), 'dokumenti-' + new Date().toISOString().slice(0, 10) + '.zip');
      toast('Izvoženih dokumentov: ' + ids.length + ' (' + files.length + ' datotek).');
    } catch (e) {
      toast('Izvoz ni uspel: ' + (e && e.message ? e.message : e));
    }
  }

  window.__dmsDownloads = { save: save, zip: zip, downloadBlob: downloadBlob, exportZip: exportZip };
})();
