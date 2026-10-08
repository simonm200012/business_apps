/* Adrial Apps · Desk — .eml (MIME, RFC 5322 / 2045 / 2047 / 2231) reader. No libraries, no network.
 *
 *   DeskEml.parse(arrayBufferOrUint8Array) → same shape as DeskMsg.parse:
 *     { subject, from, to, cc, date, messageId, text, html, rtfOnly:false, headers, attachments }
 *
 * The file is read as a "binary string" (one char per byte) so the structure can be split with
 * string functions; each part's bytes are decoded with its own charset via TextDecoder.
 */
(function (root) {
  'use strict';

  var M = root.DeskMsg || (typeof require === 'function' ? require('./msg.js') : null);

  function toBinary(u8) {
    var out = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return out;
  }
  function toBytes(bin) {
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xFF;
    return u8;
  }
  function decoder(charset) {
    var cs = String(charset || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!cs || cs === 'us-ascii' || cs === 'ascii' || cs === 'unknown-8bit' || cs === 'x-unknown') cs = 'utf-8';
    if (cs === 'cp1250') cs = 'windows-1250';
    if (cs === 'cp1252') cs = 'windows-1252';
    try { return new TextDecoder(cs); } catch (e) { return new TextDecoder('utf-8'); }
  }
  // header bytes: often raw UTF-8 even though RFC 5322 says ASCII
  function headerText(bin) {
    if (!/[\x80-\xff]/.test(bin)) return bin;
    var b = toBytes(bin);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return new TextDecoder('windows-1252').decode(b); }
  }
  function atobSafe(s) {
    s = String(s).replace(/[^A-Za-z0-9+/=]/g, '');
    s = s.replace(/=+$/, '');
    while (s.length % 4) s += '=';
    if (s.length % 4 === 1) s = s.slice(0, -1);
    try { return typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); } catch (e) { return ''; }
  }

  function splitHead(bin) {
    var m = /\r?\n\r?\n/.exec(bin);
    if (!m) return { head: bin, body: '' };
    return { head: bin.slice(0, m.index), body: bin.slice(m.index + m[0].length) };
  }
  function parseHeaders(head) {
    var list = [], map = {};
    head.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n').forEach(function (line) {
      var m = /^([!-9;-~]+)\s*:\s?(.*)$/.exec(line);
      if (!m) return;
      var k = m[1].toLowerCase();
      list.push([k, m[2]]);
      (map[k] = map[k] || []).push(m[2]);
    });
    return { list: list, get: function (k) { return map[k] ? map[k][0] : ''; }, all: function (k) { return map[k] || []; } };
  }

  // value; a=b; c="d"; e*=utf-8''%C4%8D; f*0="x"; f*1="y"
  function parseParams(raw) {
    raw = String(raw || '');
    var parts = [], cur = '', q = false;
    for (var i = 0; i < raw.length; i++) {
      var ch = raw[i];
      if (ch === '"' && raw[i - 1] !== '\\') q = !q;
      if (ch === ';' && !q) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    var value = parts.shift().trim().toLowerCase();
    var params = {}, ext = {};
    parts.forEach(function (p) {
      var m = /^\s*([^=\s]+)\s*=\s*(.*)\s*$/.exec(p);
      if (!m) return;
      var key = m[1].toLowerCase(), val = m[2].trim();
      if (/^".*"$/.test(val)) val = val.slice(1, -1).replace(/\\(.)/g, '$1');
      var em = /^([^*]+)\*(?:(\d+)\*?)?$/.exec(key);
      if (em) {
        var base = em[1], idx = em[2] == null ? 0 : +em[2], encoded = /\*$/.test(key);
        (ext[base] = ext[base] || []).push({ idx: idx, val: val, encoded: encoded });
      } else params[key] = val;
    });
    Object.keys(ext).forEach(function (base) {
      var segs = ext[base].sort(function (a, b) { return a.idx - b.idx; });
      var charset = 'utf-8', bytes = [];
      segs.forEach(function (s, n) {
        var v = s.val;
        if (s.encoded) {
          if (n === 0) { var cm = /^([^']*)'[^']*'(.*)$/.exec(v); if (cm) { charset = cm[1] || charset; v = cm[2]; } }
          v.replace(/%([0-9A-Fa-f]{2})|([\s\S])/g, function (all, h, c) { bytes.push(h ? parseInt(h, 16) : c.charCodeAt(0) & 0xFF); return ''; });
        } else for (var k = 0; k < v.length; k++) bytes.push(v.charCodeAt(k) & 0xFF);
      });
      params[base] = decoder(charset).decode(new Uint8Array(bytes));
    });
    return { value: value, params: params };
  }

  function decodeWords(s) { return M ? M.decodeWords(s) : s; }

  function decodeBody(bin, cte) {
    cte = String(cte || '').trim().toLowerCase();
    if (cte === 'base64') return atobSafe(bin);
    if (cte === 'quoted-printable') {
      return bin.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, function (a, h) { return String.fromCharCode(parseInt(h, 16)); });
    }
    return bin;
  }

  function splitMultipart(body, boundary) {
    var delim = '--' + boundary, parts = [];
    var pos = body.indexOf(delim);
    if (pos < 0) return parts;
    var guard = 0;
    while (pos >= 0 && guard++ < 1000) {
      if (body.substr(pos + delim.length, 2) === '--') break;
      var lineEnd = body.indexOf('\n', pos);
      if (lineEnd < 0) break;
      var next = body.indexOf('\n' + delim, lineEnd);
      if (next < 0) { parts.push(body.slice(lineEnd + 1)); break; }
      var end = next;
      if (body[end - 1] === '\r') end--;
      parts.push(body.slice(lineEnd + 1, end));
      pos = next + 1;
    }
    return parts;
  }

  function walk(bin, out, depth) {
    var sp = splitHead(bin);
    var H = parseHeaders(sp.head);
    var ct = parseParams(H.get('content-type') || 'text/plain; charset=us-ascii');
    var cd = parseParams(H.get('content-disposition'));
    var cte = H.get('content-transfer-encoding');
    var type = ct.value || 'text/plain';
    var name = cd.params.filename || ct.params.name || '';
    name = name ? decodeWords(headerText(name)) : '';
    var cid = String(H.get('content-id') || '').trim().replace(/^<|>$/g, '');

    if (/^multipart\//.test(type) && ct.params.boundary && depth < 20) {
      splitMultipart(sp.body, ct.params.boundary).forEach(function (p) { walk(p, out, depth + 1); });
      return;
    }
    var raw = decodeBody(sp.body, cte);
    var isAttachment = cd.value === 'attachment' || (!!name && !/^text\/(plain|html)$/.test(type)) || (!!name && cd.value !== 'inline');
    if (type === 'message/rfc822' && !isAttachment) isAttachment = true;

    if (!isAttachment && type === 'text/plain' && out.text == null) { out.text = decoder(ct.params.charset).decode(toBytes(raw)); return; }
    if (!isAttachment && type === 'text/html' && out.html == null) { out.html = decoder(ct.params.charset).decode(toBytes(raw)); return; }
    if (!isAttachment && /^text\//.test(type) && !name) {
      // extra text parts (e.g. a calendar invitation shown inline): keep as an attachment
      name = type === 'text/calendar' ? 'invite.ics' : 'part-' + (out.attachments.length + 1) + '.txt';
    }
    if (type === 'message/rfc822' && !name) {
      var inner = parseHeaders(splitHead(raw).head);
      name = (decodeWords(headerText(inner.get('subject'))) || 'Attached message').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) + '.eml';
    }
    if (!name) name = cid ? cid.replace(/@.*/, '') : 'attachment-' + (out.attachments.length + 1);
    var inline = !!cid && cd.value !== 'attachment' && /^image\//.test(type);
    out.attachments.push({ name: name, type: type === 'application/octet-stream' && M ? M.typeFromName(name) : type, data: toBytes(raw), cid: cid, inline: inline });
  }

  function parse(input) {
    var u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    var bin = toBinary(u8);
    if (bin.charCodeAt(0) === 0xEF && bin.charCodeAt(1) === 0xBB && bin.charCodeAt(2) === 0xBF) bin = bin.slice(3);
    bin = bin.replace(/^(From [^\n]*\n)/, ''); // mbox "From " line
    var top = parseHeaders(splitHead(bin).head);
    var out = { text: null, html: null, attachments: [] };
    walk(bin, out, 0);
    var hdr = function (k) { return decodeWords(headerText(top.get(k))); };
    var fromList = M ? M.splitAddresses(hdr('from')) : [];
    var date = null;
    if (top.get('date')) { var t = Date.parse(top.get('date').replace(/\s*\([^)]*\)\s*$/, '')); if (!isNaN(t)) date = new Date(t).toISOString(); }
    var headers = {};
    top.list.forEach(function (kv) { if (!(kv[0] in headers)) headers[kv[0]] = decodeWords(headerText(kv[1])); });
    if (!/^[\s\S]{0,4000}?\b(from|subject|date|to|message-id|mime-version|received)\s*:/im.test(splitHead(bin).head)) throw new Error('This does not look like an e-mail (.eml) file.');
    return {
      subject: hdr('subject'),
      from: fromList[0] || { name: '', address: '' },
      to: M ? M.splitAddresses(hdr('to')) : [],
      cc: M ? M.splitAddresses(hdr('cc')) : [],
      date: date,
      messageId: String(top.get('message-id') || '').trim(),
      text: out.text || '',
      html: out.html || '',
      rtfOnly: false,
      headers: headers,
      attachments: out.attachments
    };
  }

  var api = { parse: parse, parseParams: parseParams, decodeBody: decodeBody };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeskEml = api;
})(typeof window !== 'undefined' ? window : this);
