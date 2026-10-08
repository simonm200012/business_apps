/* InvoiceRegions: page-relative geometry for selecting fields on a document: text in a rectangle, anchors, template matching. Pure (no DOM). */
(function (root) {
  'use strict';
  var P = (typeof require === 'function' && typeof module !== 'undefined') ? (function () { try { return require('./parser.js'); } catch (e) { return null; } })() : root.InvoiceParser;
  /* item: { s, x, y, w, h, p } with x,y,w,h as fractions of the page (0..1, y down) */
  var FIELDS = [
    { key: 'vendor', label: 'Vendor', input: 'd-vendor', type: 'text' }, { key: 'vendorTaxId', label: 'VAT ID', input: 'd-vatid', type: 'vatid' },
    { key: 'number', label: 'Invoice number', input: 'd-number', type: 'text' }, { key: 'issueDate', label: 'Issue date', input: 'd-issue', type: 'date' },
    { key: 'dueDate', label: 'Due date', input: 'd-due', type: 'date' }, { key: 'serviceDate', label: 'Service date', input: 'd-service', type: 'date' },
    { key: 'total', label: 'Total', input: 'd-total', type: 'amount' }, { key: 'vat', label: 'VAT', input: 'd-vat', type: 'amount' }, { key: 'net', label: 'Net', input: 'd-net', type: 'amount' },
    { key: 'iban', label: 'IBAN', input: 'd-iban', type: 'iban' }, { key: 'reference', label: 'Reference', input: 'd-ref', type: 'text' }, { key: 'poNumber', label: 'PO number', input: 'd-po', type: 'text' }];
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rectFrom(p, x1, y1, x2, y2) {
    var x = clamp(Math.min(x1, x2), 0, 1), y = clamp(Math.min(y1, y2), 0, 1);
    return { p: p, x: x, y: y, w: clamp(Math.max(x1, x2), 0, 1) - x, h: clamp(Math.max(y1, y2), 0, 1) - y };
  }
  /* pdf.js text item + viewport.transform -> item (page fractions). vw/vh = viewport width/height */
  function fromPdfItem(it, vt, vw, vh, p) {
    var t = it.transform, a = vt[0] * t[0] + vt[2] * t[1], b = vt[1] * t[0] + vt[3] * t[1], c = vt[0] * t[2] + vt[2] * t[3], d = vt[1] * t[2] + vt[3] * t[3];
    var e = vt[0] * t[4] + vt[2] * t[5] + vt[4], f = vt[1] * t[4] + vt[3] * t[5] + vt[5], h = Math.hypot(c, d) || Math.hypot(a, b), sc = Math.hypot(vt[0], vt[1]) || 1;
    return { s: it.str, x: e / vw, y: (f - h) / vh, w: (it.width * sc) / vw, h: h / vh, p: p };
  }
  function lineObjects(items) {
    var pages = {}, out = [];
    items.forEach(function (it) { if (it.s && it.s.trim()) (pages[it.p || 0] = pages[it.p || 0] || []).push(it); });
    Object.keys(pages).map(Number).sort(function (a, b) { return a - b; }).forEach(function (pg) {
      var arr = pages[pg].slice().sort(function (a, b) { return (a.y + a.h) - (b.y + b.h) || a.x - b.x; }), cur = null;
      arr.forEach(function (it) {
        var base = it.y + it.h;
        if (cur && Math.abs(base - cur.base) <= Math.max(cur.h, it.h) * 0.45) { cur.items.push(it); cur.base = (cur.base * (cur.items.length - 1) + base) / cur.items.length; cur.h = Math.max(cur.h, it.h); }
        else { cur = { p: pg, base: base, h: it.h, items: [it] }; out.push(cur); }
      });
    });
    out.forEach(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var s = '', prevEnd = null;
      ln.items.forEach(function (it) {
        if (prevEnd != null) { var gap = it.x - prevEnd; s += gap > ln.h * 1.4 ? '   ' : (gap > ln.h * 0.12 && !/\s$/.test(s) && !/^\s/.test(it.s) ? ' ' : ''); }
        s += it.s; prevEnd = it.x + it.w;
      });
      ln.text = s.replace(/\s+$/, ''); ln.x = ln.items[0].x; ln.y = ln.base - ln.h;
    });
    return out;
  }
  function linesFromItems(items) { return lineObjects(items).map(function (l) { return l.text; }).filter(function (s) { return s.trim(); }); }
  function inRect(it, r) { var cx = it.x + it.w / 2, cy = it.y + it.h / 2; return (it.p || 0) === r.p && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h; }
  function textInRect(items, r, sep) {
    var sel = items.filter(function (it) { return inRect(it, r); });
    return lineObjects(sel).map(function (l) { return l.text.replace(/\s{3,}/g, ' '); }).join(sep == null ? ' ' : sep).trim();
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  /* nearest text left of / above the rectangle (outside it) so the field survives small layout shifts */
  function findAnchor(items, r) {
    var best = null, bd = 1e9;
    items.forEach(function (it) {
      if ((it.p || 0) !== r.p || inRect(it, r) || !/[A-Za-zČŠŽčšž]{3}/.test(it.s) || it.s.length > 40) return;
      var left = it.x + it.w <= r.x + 0.01, above = it.y + it.h <= r.y + 0.01;
      if (!left && !above) return;
      var dx = r.x - it.x, dy = r.y - it.y, d = Math.hypot(dx * 1.0, dy * 2.2);
      if (d < bd && d < 0.6) { bd = d; best = { s: norm(it.s), dx: dx, dy: dy }; }
    });
    return best;
  }
  /* region of a template field on this document, shifted by its anchor if the anchor text is found */
  function locate(f, items) {
    var r = { p: f.p || 0, x: f.x, y: f.y, w: f.w, h: f.h, anchored: false };
    if (!f.anchor) return r;
    var best = null, bd = 1e9;
    items.forEach(function (it) {
      if ((it.p || 0) !== r.p || norm(it.s) !== f.anchor.s) return;
      var d = Math.hypot(it.x - (f.x - f.anchor.dx), it.y - (f.y - f.anchor.dy)); if (d < bd) { bd = d; best = it; }
    });
    if (best && bd < 0.4) { r.x = clamp(best.x + f.anchor.dx, 0, 1 - f.w); r.y = clamp(best.y + f.anchor.dy, 0, 1 - f.h); r.anchored = true; }
    return r;
  }
  function fingerprint(items) {
    var seen = {}, out = [];
    items.filter(function (it) { return (it.p || 0) === 0 && (it.y < 0.28 || it.y > 0.9); }).forEach(function (it) {
      norm(it.s).split(/[^a-zčšž0-9]+/).forEach(function (w) { if (w.length >= 4 && !/^\d+$/.test(w) && !seen[w]) { seen[w] = 1; out.push(w); } });
    });
    return out.sort().slice(0, 60);
  }
  function similarity(a, b) {
    if (!a || !b || !a.length || !b.length) return 0;
    var set = {}, inter = 0; a.forEach(function (x) { set[x] = 1; }); b.forEach(function (x) { if (set[x]) inter++; });
    return inter / (a.length + b.length - inter);
  }
  function matchTemplate(templates, ctx) {
    var best = null, vat = String(ctx.vatId || '').toUpperCase(), nk = P ? P.normName(ctx.vendor || '') : norm(ctx.vendor), fp = ctx.items ? fingerprint(ctx.items) : [];
    (templates || []).forEach(function (t) {
      var score = 0, how = '';
      if (vat && t.vatId && t.vatId.toUpperCase() === vat) { score = 1; how = 'VAT ID'; }
      else if (nk && t.nameKey && t.nameKey === nk) { score = 0.9; how = 'name'; }
      else { var s = similarity(t.fingerprint, fp); if (s >= 0.55) { score = s * 0.8; how = 'layout'; } }
      if (score && (!best || score > best.score)) best = { template: t, score: score, how: how };
    });
    return best;
  }
  function cast(type, text) {
    text = String(text || '').trim(); if (!text || !P) return text;
    if (type === 'date') { var d = P.findDates(text)[0]; return d ? d.iso : ''; }
    if (type === 'amount') { var a = P.amountsIn(text)[0]; if (a) return a.v; var n = P.toNumber(text); return isFinite(n) ? n : ''; }
    if (type === 'iban') { var ib = P.findIbans([text.toUpperCase()])[0]; return ib ? ib.iban : text.replace(/\s+/g, '').toUpperCase(); }
    if (type === 'vatid') { var v = P.findVatIds([text]); return v[0] ? v[0].id : P.vatNorm(text); }
    return text.replace(/\s+/g, ' ');
  }
  function readTemplate(t, items) {
    var out = {};
    Object.keys(t.fields || {}).forEach(function (k) {
      var f = t.fields[k], def = FIELDS.filter(function (x) { return x.key === k; })[0], r = locate(f, items), txt = textInRect(items, r);
      if (txt) { var v = cast(def ? def.type : 'text', txt); if (v !== '' && v != null) out[k] = v; }
    });
    return out;
  }
  function cleanTemplate(t) {
    var o = { id: t.id || 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(t.name || t.vendor || 'Template').slice(0, 80), vatId: String(t.vatId || '').toUpperCase(),
      nameKey: t.nameKey || (P ? P.normName(t.name || '') : ''), fingerprint: (t.fingerprint || []).slice(0, 60), fields: {}, fixedBilledTo: t.fixedBilledTo || '', fixedBilledPerson: t.fixedBilledPerson || '',
      uses: t.uses | 0, createdAt: t.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    Object.keys(t.fields || {}).forEach(function (k) {
      var f = t.fields[k]; if (!FIELDS.some(function (x) { return x.key === k; }) || !f) return;
      var x = +f.x, y = +f.y, w = +f.w, h = +f.h; if (![x, y, w, h].every(isFinite) || w <= 0 || h <= 0) return;
      o.fields[k] = { p: f.p | 0, x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0.002, 1), h: clamp(h, 0.002, 1), anchor: f.anchor && f.anchor.s ? { s: String(f.anchor.s).slice(0, 40), dx: +f.anchor.dx || 0, dy: +f.anchor.dy || 0 } : null };
    });
    return o;
  }
  var api = { FIELDS: FIELDS, rectFrom: rectFrom, fromPdfItem: fromPdfItem, lineObjects: lineObjects, linesFromItems: linesFromItems, textInRect: textInRect, inRect: inRect, findAnchor: findAnchor,
    locate: locate, fingerprint: fingerprint, similarity: similarity, matchTemplate: matchTemplate, readTemplate: readTemplate, cast: cast, cleanTemplate: cleanTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.InvoiceRegions = api;
})(typeof window !== 'undefined' ? window : globalThis);
