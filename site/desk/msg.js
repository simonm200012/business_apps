/* Adrial Apps · Desk — Outlook .msg reader (no libraries, no network).
 *
 * A .msg file is an OLE / CFB compound file: a little FAT file system with storages (folders) and
 * streams (files). Outlook keeps every MAPI property of the mail in a stream named
 * __substg1.0_XXXXYYYY (XXXX = property id, YYYY = type: 001F Unicode string, 001E ANSI string,
 * 0102 binary, 000D embedded object), fixed-size properties (dates, numbers) in
 * __properties_version1.0, recipients in __recip_version1.0_#n and attachments in
 * __attach_version1.0_#n storages.
 *
 *   DeskMsg.parse(arrayBufferOrUint8Array) →
 *     { subject, from: {name, address}, to: [{name, address}], cc: [...], date (ISO or null),
 *       messageId, text, html, rtfOnly, headers, attachments: [{name, type, data: Uint8Array, cid, inline}] }
 *
 * Runs in the browser (window.DeskMsg) and in Node for tests (module.exports).
 */
(function (root) {
  'use strict';

  var ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF, NOSTREAM = 0xFFFFFFFF;
  var SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

  function isCfb(u8) {
    if (!u8 || u8.length < 512) return false;
    for (var i = 0; i < 8; i++) if (u8[i] !== SIG[i]) return false;
    return true;
  }

  function utf16(u8, off, len) {
    var s = '';
    for (var i = 0; i + 1 < len; i += 2) s += String.fromCharCode(u8[off + i] | (u8[off + i + 1] << 8));
    return s;
  }

  // ---------- compound file ----------

  function readCfb(input) {
    var u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!isCfb(u8)) throw new Error('This is not an Outlook .msg file.');
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var u32 = function (o) { return o + 4 <= u8.length ? dv.getUint32(o, true) : FREESECT; };
    var secShift = dv.getUint16(0x1E, true), miniShift = dv.getUint16(0x20, true);
    var secSize = 1 << secShift, miniSize = 1 << miniShift;
    if ((secSize !== 512 && secSize !== 4096) || miniSize !== 64) throw new Error('Unsupported .msg layout.');
    var nFat = u32(0x2C), dirStart = u32(0x30), cutoff = u32(0x38) || 4096;
    var miniFatStart = u32(0x3C), nMiniFat = u32(0x40), difatStart = u32(0x44);
    var maxSectors = Math.ceil((u8.length - secSize) / secSize) + 1;
    function secOff(n) { return (n + 1) * secSize; }

    // FAT sectors: the first 109 are listed in the header, the rest in a DIFAT chain
    var fatSecs = [];
    for (var i = 0; i < 109 && fatSecs.length < nFat; i++) {
      var s = u32(0x4C + i * 4);
      if (s < maxSectors) fatSecs.push(s);
    }
    var d = difatStart, guard = 0, per = secSize / 4 - 1;
    while (fatSecs.length < nFat && d < maxSectors && guard++ < 100000) {
      var off = secOff(d);
      for (var j = 0; j < per && fatSecs.length < nFat; j++) { var fs = u32(off + j * 4); if (fs < maxSectors) fatSecs.push(fs); }
      d = u32(off + per * 4);
    }
    var perSec = secSize / 4;
    var fat = new Uint32Array(fatSecs.length * perSec);
    fatSecs.forEach(function (sec, k) {
      var o = secOff(sec);
      for (var m = 0; m < perSec; m++) fat[k * perSec + m] = u32(o + m * 4);
    });

    function chain(start, table, limit) {
      var out = [], seen = {}, s = start;
      while (s !== ENDOFCHAIN && s < table.length && !seen[s] && out.length < limit) { seen[s] = 1; out.push(s); s = table[s]; }
      if (s !== ENDOFCHAIN && s < table.length && seen[s]) throw new Error('The .msg file is damaged (loop in its sector chain).');
      return out;
    }
    function readBig(start, size) {
      if (start === ENDOFCHAIN || start === FREESECT) return new Uint8Array(0);
      var need = size == null ? Infinity : Math.ceil(size / secSize);
      var secs = chain(start, fat, Math.min(need, fat.length));
      var out = new Uint8Array(secs.length * secSize);
      secs.forEach(function (sec, k) {
        var o = secOff(sec);
        out.set(u8.subarray(o, Math.min(o + secSize, u8.length)), k * secSize);
      });
      return size == null ? out : out.subarray(0, Math.min(size, out.length));
    }

    // directory
    var dirBytes = readBig(dirStart, null);
    var entries = [];
    for (var e = 0; e * 128 + 128 <= dirBytes.length; e++) {
      var b = e * 128, dd = new DataView(dirBytes.buffer, dirBytes.byteOffset + b, 128);
      var nameLen = dd.getUint16(0x40, true);
      var type = dirBytes[b + 0x42];
      entries.push({
        index: e,
        name: utf16(dirBytes, b, Math.max(0, Math.min(64, nameLen) - 2)),
        type: type, // 0 empty, 1 storage, 2 stream, 5 root
        left: dd.getUint32(0x44, true), right: dd.getUint32(0x48, true), child: dd.getUint32(0x4C, true),
        start: dd.getUint32(0x74, true),
        size: secSize === 512 ? dd.getUint32(0x78, true) : dd.getUint32(0x78, true) + dd.getUint32(0x7C, true) * 4294967296
      });
    }
    if (!entries.length || entries[0].type !== 5) throw new Error('The .msg file is damaged (no root entry).');

    var rootEntry = entries[0];
    var miniStream = readBig(rootEntry.start, rootEntry.size);
    var miniFatBytes = readBig(miniFatStart, nMiniFat * secSize);
    var miniFat = new Uint32Array(Math.floor(miniFatBytes.length / 4));
    var mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    for (var q = 0; q < miniFat.length; q++) miniFat[q] = mdv.getUint32(q * 4, true);

    function readMini(start, size) {
      var secs = chain(start, miniFat, Math.ceil(size / miniSize));
      var out = new Uint8Array(secs.length * miniSize);
      secs.forEach(function (sec, k) { out.set(miniStream.subarray(sec * miniSize, sec * miniSize + miniSize), k * miniSize); });
      return out.subarray(0, Math.min(size, out.length));
    }
    function streamData(en) {
      if (en.size === 0) return new Uint8Array(0);
      return en.size < cutoff ? readMini(en.start, en.size) : readBig(en.start, en.size);
    }
    function childrenOf(en) {
      var out = [], stack = [en.child], seen = {};
      while (stack.length) {
        var id = stack.pop();
        if (id === NOSTREAM || id >= entries.length || seen[id]) continue;
        seen[id] = 1;
        var c = entries[id];
        if (c.type === 1 || c.type === 2) out.push(c);
        stack.push(c.left, c.right);
      }
      return out;
    }
    function node(en) {
      var kids = null;
      return {
        name: en.name,
        isStorage: en.type === 1 || en.type === 5,
        isStream: en.type === 2,
        children: function () { if (!kids) kids = childrenOf(en).map(node); return kids; },
        child: function (name) { var up = name.toUpperCase(); return this.children().find(function (k) { return k.name.toUpperCase() === up; }) || null; },
        data: function () { return streamData(en); }
      };
    }
    return { root: node(rootEntry) };
  }

  // ---------- MAPI properties ----------

  var CP_LABELS = { 65001: 'utf-8', 20127: 'us-ascii', 28591: 'iso-8859-1', 28592: 'iso-8859-2', 28595: 'iso-8859-5', 28597: 'iso-8859-7', 28605: 'iso-8859-15', 866: 'ibm866', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 20866: 'koi8-r', 50220: 'iso-2022-jp', 51932: 'euc-jp', 1200: 'utf-16le' };
  function decoderFor(cp) {
    var label = CP_LABELS[cp] || (cp >= 874 && cp <= 1258 ? 'windows-' + cp : 'windows-1252');
    try { return new TextDecoder(label); } catch (e) { return new TextDecoder('windows-1252'); }
  }
  function stripNul(s) { return String(s || '').replace(/\u0000+$/g, '').replace(/\u0000/g, ''); }

  function filetimeToIso(lo, hi) {
    var ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
    if (!isFinite(ms) || ms < 0 || ms > 7258118400000) return null; // up to year 2200
    return new Date(ms).toISOString();
  }

  // the __properties_version1.0 stream: header (32 bytes top level, 24 embedded message, 8 for
  // recipients / attachments), then 16-byte entries: tag (type | id << 16), flags, 8-byte value
  function fixedProps(storage, headerSize) {
    var out = {};
    var st = storage.child('__properties_version1.0');
    if (!st) return out;
    var u8 = st.data(), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    for (var o = headerSize; o + 16 <= u8.length; o += 16) {
      var tag = dv.getUint32(o, true), type = tag & 0xFFFF, id = tag >>> 16;
      var v;
      if (type === 0x0003) v = dv.getInt32(o + 8, true);
      else if (type === 0x000B) v = dv.getUint16(o + 8, true) !== 0;
      else if (type === 0x0040) v = filetimeToIso(dv.getUint32(o + 8, true), dv.getUint32(o + 12, true));
      else if (type === 0x0014) v = dv.getUint32(o + 8, true) + dv.getUint32(o + 12, true) * 4294967296;
      else continue;
      out[id] = v;
    }
    return out;
  }

  function propReader(storage, cpDecoder) {
    var map = {};
    storage.children().forEach(function (c) {
      var m = /^__substg1\.0_([0-9A-F]{4})([0-9A-F]{4})$/i.exec(c.name);
      if (m) map[m[1].toUpperCase() + m[2].toUpperCase()] = c;
    });
    var r = {
      has: function (id, type) { return !!map[hex(id) + type]; },
      str: function (id) {
        var u = map[hex(id) + '001F'];
        if (u && u.isStream) { var d = u.data(); return stripNul(utf16(d, 0, d.length)); }
        var a = map[hex(id) + '001E'];
        if (a && a.isStream) return stripNul(r.dec().decode(a.data()));
        return '';
      },
      bin: function (id) {
        var b = map[hex(id) + '0102'];
        return b && b.isStream ? b.data() : null;
      },
      obj: function (id) { var o = map[hex(id) + '000D']; return o && o.isStorage ? o : null; },
      dec: function () { return cpDecoder || new TextDecoder('windows-1252'); }
    };
    return r;
  }
  function hex(id) { return ('0000' + id.toString(16).toUpperCase()).slice(-4); }

  // ---------- transport headers (fallback for sender address, date, Message-ID) ----------

  function parseHeaderBlock(raw) {
    var out = {};
    String(raw || '').replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n').forEach(function (line) {
      var m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
      if (m) { var k = m[1].toLowerCase(); if (!(k in out)) out[k] = m[2]; }
    });
    return out;
  }
  function decodeWords(s) {
    return String(s || '').replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, function (all, cs, enc, txt) {
      try {
        var bytes;
        if (enc.toUpperCase() === 'B') { var bin = atobSafe(txt); bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
        else {
          var t = txt.replace(/_/g, ' '), arr = [];
          for (var k = 0; k < t.length; k++) {
            if (t[k] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.substr(k + 1, 2))) { arr.push(parseInt(t.substr(k + 1, 2), 16)); k += 2; }
            else arr.push(t.charCodeAt(k) & 0xFF);
          }
          bytes = new Uint8Array(arr);
        }
        return new TextDecoder(cs.split('*')[0].trim()).decode(bytes);
      } catch (e) { return all; }
    });
  }
  function atobSafe(s) {
    s = String(s).replace(/[^A-Za-z0-9+/=]/g, '');
    if (typeof atob === 'function') return atob(s);
    return Buffer.from(s, 'base64').toString('binary');
  }
  function parseAddress(s) {
    s = decodeWords(String(s || '').trim());
    var m = /^(.*?)\s*<([^>]*)>\s*$/.exec(s);
    if (m) return { name: m[1].replace(/^["'\s]+|["'\s]+$/g, '').replace(/\\"/g, '"'), address: m[2].trim() };
    if (/@/.test(s)) return { name: '', address: s.replace(/^mailto:/i, '') };
    return { name: s.replace(/^["'\s]+|["'\s]+$/g, ''), address: '' };
  }
  function splitAddresses(s) {
    var out = [], cur = '', q = false, ang = false;
    String(s || '').split('').forEach(function (ch) {
      if (ch === '"') q = !q;
      if (!q && ch === '<') ang = true;
      if (!q && ch === '>') ang = false;
      if ((ch === ',' || ch === ';') && !q && !ang) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
    });
    if (cur.trim()) out.push(cur.trim());
    return out.map(parseAddress).filter(function (a) { return a.name || a.address; });
  }

  // ---------- message ----------

  var EXT_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', txt: 'text/plain', htm: 'text/html', html: 'text/html', ics: 'text/calendar', csv: 'text/csv', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook' };
  function typeFromName(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return (m && EXT_TYPES[m[1].toLowerCase()]) || 'application/octet-stream'; }

  function readMessage(storage, headerSize) {
    var fx = fixedProps(storage, headerSize);
    var cp = fx[0x3FDE] || fx[0x3FFD] || 0; // PR_INTERNET_CPID, PR_MESSAGE_CODEPAGE
    var dec = cp ? decoderFor(cp) : null;
    var P = propReader(storage, dec);
    var headers = parseHeaderBlock(P.str(0x007D)); // PR_TRANSPORT_MESSAGE_HEADERS

    var subject = P.str(0x0037) || decodeWords(headers.subject || '');
    var senderName = P.str(0x0C1A) || P.str(0x0042);
    var senderAddr = P.str(0x5D01) || P.str(0x5D02);
    if (!/@/.test(senderAddr)) { var a1 = P.str(0x0C1F); if (/@/.test(a1)) senderAddr = a1; }
    if (!/@/.test(senderAddr)) { var a2 = P.str(0x0065); if (/@/.test(a2)) senderAddr = a2; }
    var hFrom = headers.from ? parseAddress(headers.from) : null;
    if (!/@/.test(senderAddr) && hFrom) senderAddr = hFrom.address;
    if (!senderName && hFrom) senderName = hFrom.name;
    if (!/@/.test(senderAddr)) senderAddr = '';

    // recipients
    var to = [], cc = [];
    storage.children().filter(function (c) { return c.isStorage && /^__recip_version1\.0_#/i.test(c.name); })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; })
      .forEach(function (rs) {
        var rf = fixedProps(rs, 8), RP = propReader(rs, dec);
        var addr = RP.str(0x39FE) || RP.str(0x5FF7);
        if (!/@/.test(addr)) { var x = RP.str(0x3003); addr = /@/.test(x) ? x : ''; }
        var rec = { name: RP.str(0x3001) || RP.str(0x5FF6), address: addr };
        if (rec.name === rec.address) rec.name = '';
        var kind = rf[0x0C15];
        if (kind === 2) cc.push(rec); else if (kind === 1 || kind == null) to.push(rec);
      });
    if (!to.length) to = headers.to ? splitAddresses(headers.to) : P.str(0x0E04).split(';').map(function (n) { return { name: n.trim(), address: '' }; }).filter(function (r) { return r.name; });
    if (!cc.length) cc = headers.cc ? splitAddresses(headers.cc) : P.str(0x0E03).split(';').map(function (n) { return { name: n.trim(), address: '' }; }).filter(function (r) { return r.name; });

    var date = fx[0x0039] || fx[0x0E06] || null;
    if (!date && headers.date) { var t = Date.parse(headers.date); if (!isNaN(t)) date = new Date(t).toISOString(); }
    if (!date) date = fx[0x3007] || null;

    var messageId = P.str(0x1035) || headers['message-id'] || '';

    var text = P.str(0x1000);
    var html = '';
    var hb = P.bin(0x1013);
    if (hb && hb.length) {
      var hdec = dec;
      if (!hdec) {
        var head = new TextDecoder('windows-1252').decode(hb.subarray(0, 2048));
        var mc = /charset\s*=\s*["']?([A-Za-z0-9_\-]+)/i.exec(head);
        try { hdec = new TextDecoder(mc ? mc[1] : 'utf-8'); } catch (e) { hdec = new TextDecoder('utf-8'); }
      }
      html = stripNul(hdec.decode(hb));
    } else html = P.str(0x1013);
    var rtfOnly = !text && !html && !!P.bin(0x1009);

    var attachments = [];
    storage.children().filter(function (c) { return c.isStorage && /^__attach_version1\.0_#/i.test(c.name); })
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; })
      .forEach(function (as) {
        var af = fixedProps(as, 8), AP = propReader(as, dec);
        var name = AP.str(0x3707) || AP.str(0x3704) || AP.str(0x3001) || 'attachment';
        var cid = AP.str(0x3712).replace(/^<|>$/g, '');
        var inline = !!af[0x7FFE] || (!!cid && /^image\//.test(AP.str(0x370E) || typeFromName(name)));
        var method = af[0x3705];
        var data = AP.bin(0x3701);
        var embedded = AP.obj(0x3701);
        if (embedded || method === 5) {
          if (!embedded) return;
          var inner = readMessage(embedded, 24);
          attachments.push({ name: safeName((inner.subject || 'Attached message') + '.eml'), type: 'message/rfc822', data: toEml(inner), cid: '', inline: false });
          return;
        }
        if (!data) return; // OLE objects / references: nothing we can show
        attachments.push({ name: name, type: AP.str(0x370E) || typeFromName(name), data: data, cid: cid, inline: inline });
      });

    return { subject: subject, from: { name: senderName, address: senderAddr }, to: to, cc: cc, date: date, messageId: messageId.trim(), text: text, html: html, rtfOnly: rtfOnly, headers: headers, attachments: attachments };
  }

  function safeName(s) { return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }

  // an embedded message becomes a small .eml (headers + plain text) so it can be opened like any attachment
  function toEml(m) {
    function addr(a) { return a.name ? '"' + a.name.replace(/"/g, '') + '" <' + a.address + '>' : a.address; }
    var lines = [
      'From: ' + addr(m.from),
      'To: ' + m.to.map(addr).join(', '),
      m.cc.length ? 'Cc: ' + m.cc.map(addr).join(', ') : null,
      'Subject: ' + m.subject,
      m.date ? 'Date: ' + new Date(m.date).toUTCString() : null,
      m.messageId ? 'Message-ID: ' + m.messageId : null,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      m.text || (m.html ? m.html.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ') : '')
    ].filter(function (l) { return l != null; });
    return new TextEncoder().encode(lines.join('\r\n'));
  }

  function parse(input) {
    var cfb = readCfb(input);
    return readMessage(cfb.root, 32);
  }

  var api = { parse: parse, isMsg: isCfb, readCfb: readCfb, parseAddress: parseAddress, splitAddresses: splitAddresses, decodeWords: decodeWords, typeFromName: typeFromName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeskMsg = api;
})(typeof window !== 'undefined' ? window : this);
