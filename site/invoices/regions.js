/* Field regions and vendor templates for Adrial Apps · Invoices.
 *
 * Geometry is page-relative: x, y, w, h run 0–1 from the top-left corner of the page, so a
 * region drawn at one zoom level or resolution fits the same page at any other.
 * A text item is { s, x, y, w, h } in the same units (pdf.js text runs, converted once).
 *
 * Pure functions, no DOM: window.InvoiceRegions in the browser, module.exports in Node.
 */
(function (root) {
  'use strict';

  var FIELDS = [
    { key: 'vendor', label: 'Vendor name', color: '#5B3FE0' },
    { key: 'billedTo', label: 'Billed to', color: '#15803D' },
    { key: 'billedPerson', label: 'Billed to person', color: '#6D28D9' },
    { key: 'vendorTaxId', label: 'Vendor VAT ID', color: '#0E7490' },
    { key: 'number', label: 'Invoice number', color: '#B45309' },
    { key: 'issueDate', label: 'Invoice date', color: '#047857' },
    { key: 'dueDate', label: 'Due date', color: '#B91C1C' },
    { key: 'serviceDate', label: 'Delivery / service date', color: '#0369A1' },
    { key: 'net', label: 'Net amount', color: '#4D7C0F' },
    { key: 'vat', label: 'VAT amount', color: '#C2410C' },
    { key: 'vatRate', label: 'VAT rate', color: '#A16207' },
    { key: 'total', label: 'Total', color: '#BE185D' },
    { key: 'currency', label: 'Currency', color: '#475569' },
    { key: 'iban', label: 'IBAN', color: '#1D4ED8' },
    { key: 'reference', label: 'Reference / model', color: '#7E22CE' },
    { key: 'category', label: 'Category', color: '#0F766E' },
    { key: 'poNumber', label: 'PO number', color: '#9F1239' }
  ];
  var FIELD_KEYS = FIELDS.map(function (f) { return f.key; });
  function fieldInfo(key) { for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === key) return FIELDS[i]; return null; }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function clampRect(r) {
    var w = clamp(r.w, 0.004, 1);
    var h = clamp(r.h, 0.004, 1);
    return { x: r4(clamp(r.x, 0, 1 - w)), y: r4(clamp(r.y, 0, 1 - h)), w: r4(w), h: r4(h) };
  }

  // pdf.js text items + the page viewport at scale 1 → page-relative items
  function itemsFromTextContent(items, viewport) {
    var out = [];
    var W = viewport.width;
    var H = viewport.height;
    (items || []).forEach(function (it) {
      if (!it || !it.str || !it.transform) return;
      // some PDFs (e.g. Stripe invoices) draw spaces as NUL glyphs
      it = { str: it.str.replace(/[\u0000-\u001f]/g, ' '), transform: it.transform, width: it.width, height: it.height };
      if (!it.str.trim()) return;
      var t = it.transform;
      var fh = Math.hypot(t[2], t[3]) || it.height || 10;
      var w = it.width || fh * it.str.length * 0.5;
      var x0 = t[4];
      var y0 = t[5] - fh * 0.22; // include descenders
      var rect = viewport.convertToViewportRectangle([x0, y0, x0 + w, t[5] + fh * 0.98]);
      var x1 = Math.min(rect[0], rect[2]);
      var x2 = Math.max(rect[0], rect[2]);
      var y1 = Math.min(rect[1], rect[3]);
      var y2 = Math.max(rect[1], rect[3]);
      out.push({ s: it.str.replace(/ /g, ' '), x: r4(x1 / W), y: r4(y1 / H), w: r4((x2 - x1) / W), h: r4((y2 - y1) / H) });
    });
    return out;
  }

  function hasTextLayer(items) {
    var n = 0;
    (items || []).forEach(function (it) { n += it.s.replace(/\s/g, '').length; });
    return n >= 12;
  }

  // reading order: top to bottom by row, left to right within a row
  function readingOrder(items) {
    var rows = [];
    items.slice().sort(function (a, b) { return (a.y + a.h / 2) - (b.y + b.h / 2); }).forEach(function (it) {
      var cy = it.y + it.h / 2;
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].cy - cy) <= Math.max(rows[i].h, it.h) * 0.5) { row = rows[i]; break; }
      }
      if (!row) { row = { cy: cy, h: it.h, items: [] }; rows.push(row); }
      row.items.push(it);
    });
    rows.sort(function (a, b) { return a.cy - b.cy; });
    rows.forEach(function (r) { r.items.sort(function (a, b) { return a.x - b.x; }); });
    return rows;
  }

  function joinRows(rows) {
    return rows.map(function (r) {
      var out = '';
      var lastEnd = null;
      r.items.forEach(function (it) {
        if (lastEnd !== null) {
          var gap = it.x - lastEnd;
          if (gap > r.h * 1.6) out += '   ';
          else if (!/\s$/.test(out) && !/^\s/.test(it.s) && gap > r.h * 0.08) out += ' ';
        }
        out += it.s;
        lastEnd = it.x + it.w;
      });
      return out.replace(/\s+$/, '').replace(/^\s+/, '');
    }).filter(Boolean).join('\n');
  }

  // Text inside a rectangle. Items cut by the rectangle's left/right edge keep only the
  // characters whose (estimated) centre lies inside it.
  function textInRect(items, rect) {
    if (!items || !rect) return '';
    var rx2 = rect.x + rect.w;
    var ry2 = rect.y + rect.h;
    var picked = [];
    items.forEach(function (it) {
      var oy = Math.min(it.y + it.h, ry2) - Math.max(it.y, rect.y);
      if (oy <= 0 || oy < it.h * 0.45) return;
      var ox1 = Math.max(it.x, rect.x);
      var ox2 = Math.min(it.x + it.w, rx2);
      if (ox2 <= ox1) return;
      var s = it.s;
      var x = it.x;
      var w = it.w;
      if (it.w > 0 && (ox2 - ox1) / it.w < 0.97) {
        var n = s.length;
        var a = -1;
        var b = -1;
        for (var i = 0; i < n; i++) {
          var cx = it.x + ((i + 0.5) / n) * it.w;
          if (cx >= rect.x && cx <= rx2) { if (a === -1) a = i; b = i; }
        }
        if (a === -1) return;
        s = s.slice(a, b + 1);
        x = it.x + (a / n) * it.w;
        w = ((b - a + 1) / n) * it.w;
      }
      if (!s.trim()) return;
      picked.push({ s: s, x: x, y: it.y, w: w, h: it.h });
    });
    return joinRows(readingOrder(picked));
  }

  function itemsInRect(items, rect) {
    return (items || []).filter(function (it) {
      var cx = it.x + it.w / 2;
      var cy = it.y + it.h / 2;
      return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    });
  }

  // the smallest item under a point (with a little slack for thin text)
  function itemAt(items, px, py, slack) {
    var s = slack == null ? 0.004 : slack;
    var best = null;
    (items || []).forEach(function (it) {
      if (px >= it.x - s && px <= it.x + it.w + s && py >= it.y - s && py <= it.y + it.h + s) {
        if (!best || it.w * it.h < best.w * best.h) best = it;
      }
    });
    return best;
  }

  function unionRect(list, pad) {
    if (!list.length) return null;
    var p = pad == null ? 0.003 : pad;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    list.forEach(function (it) {
      x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
      x2 = Math.max(x2, it.x + it.w); y2 = Math.max(y2, it.y + it.h);
    });
    return clampRect({ x: x1 - p, y: y1 - p, w: x2 - x1 + 2 * p, h: y2 - y1 + 2 * p });
  }

  // ---------- anchors (nearby label text) ----------

  // "Datum računa: 31.12.2026" → "Datum računa"; "Skupaj za plačilo 1.234,56 €" → "Skupaj za plačilo"
  function labelPart(s) {
    var t = String(s || '');
    if (t.indexOf(':') > 1) t = t.slice(0, t.indexOf(':'));
    t = t.replace(/[\s]*[-–]?\s*[\d€$£%][\s\S]*$/, '');
    t = t.replace(/[\s:#.,\-–]+$/, '').trim();
    var letters = (t.match(/[A-Za-zÀ-ž]/g) || []).length;
    return letters >= 3 && t.length <= 60 ? t : '';
  }

  var KNOWN_LABEL = /^\s*(bill(?:ed)?\s+to|invoice\s+to|sold\s+to|kupec|kupac|prejemnik|primatelj|naro[cč]nik|buyer|customer|ra[cč]un\s+za|invoice\s+(?:number|date|no\.?)|date\s+of\s+issue|date\s+due|due\s+date|amount\s+due|total|subtotal|skupaj|za\s+pla[cč]ilo|datum\s+\w+|rok\s+pla[cč]ila|iban|sklic|vat\s+(?:id|registration)|id\s+za\s+ddv)\b\s*:?\s*$/i;

  // the label most likely to describe the value in rect: inside the rect at its start,
  // else just to the left on the same row, else just above
  function findAnchor(items, rect) {
    var best = null;
    var rx2 = rect.x + rect.w;
    var ry2 = rect.y + rect.h;
    var inRect = itemsInRect(items, rect);
    (items || []).forEach(function (it) {
      var label = labelPart(it.s);
      if (!label) return;
      var cy = it.y + it.h / 2;
      var inside = it.x >= rect.x - 0.004 && it.x + it.w <= rx2 + 0.02 && cy >= rect.y && cy <= ry2;
      var score = null;
      if (inside) {
        // a label inside the box moves with the value: best possible anchor. It is a label if it
        // carries its own value ("Datum: 1.1.2026"), ends with ':' or sits before a number in the box.
        var withValue = it.s.length > label.length + 1 || /:\s*$/.test(it.s) ||
          inRect.some(function (o) { return o !== it && /\d/.test(o.s) && o.x >= it.x + it.w - 0.002; });
        // a well-known label word ("Bill to", "Kupec", "Total" …) is the steadiest anchor of all
        var known = it.s.trim().length <= 32 && KNOWN_LABEL.test(it.s);
        if (known) score = 0.0001 + (it.y - rect.y) * 0.01;
        else if (withValue) score = 0.001 + (it.x - rect.x) + (it.y - rect.y);
        else return;
      } else if (cy >= rect.y - it.h * 0.5 && cy <= ry2 + it.h * 0.5 && it.x + it.w <= rect.x + 0.01) {
        var dl = rect.x - (it.x + it.w);
        if (dl <= 0.8) score = 0.01 + dl;
      } else if (it.y + it.h <= rect.y + 0.006 && it.x <= rx2 + 0.03 && it.x + it.w >= rect.x - 0.03) {
        var da = rect.y - (it.y + it.h);
        if (da <= 0.08) score = 0.02 + da * 3;
      }
      if (score != null && (!best || score < best.score)) best = { score: score, text: label, x: it.x, y: it.y };
    });
    return best ? { text: best.text, x: best.x, y: best.y } : null;
  }

  // Where a template region lands on this invoice: shifted with its anchor if the label is
  // found (nearest occurrence to where it was; another page only if not on the stored one).
  function locate(region, pages) {
    var base = { page: region.page, x: region.x, y: region.y, w: region.w, h: region.h, anchored: false };
    if (!region.anchor || !region.anchor.text || !pages) return base;
    var target = norm(region.anchor.text);
    if (target.length < 3) return base;
    var a = region.anchor;
    function search(pi) {
      var hit = null;
      (pages[pi] || []).forEach(function (it) {
        var lp = norm(labelPart(it.s));
        var full = norm(it.s);
        if (!(lp === target || (target.length >= 4 && full.indexOf(target) === 0))) return;
        var d = Math.hypot(it.x - a.x, it.y - a.y);
        if (!hit || d < hit.d) hit = { it: it, d: d, page: pi + 1 };
      });
      return hit;
    }
    var hit = search(region.page - 1);
    if (hit && hit.d > 0.35) hit = null;
    if (!hit) {
      for (var p = 0; p < pages.length && !hit; p++) if (p !== region.page - 1) hit = search(p);
    }
    if (!hit) return base;
    var moved = clampRect({ x: region.x + (hit.it.x - a.x), y: region.y + (hit.it.y - a.y), w: region.w, h: region.h });
    return { page: hit.page, x: moved.x, y: moved.y, w: moved.w, h: moved.h, anchored: true };
  }

  // ---------- template matching ----------

  function fingerprint(items) {
    var set = {};
    (items || []).forEach(function (it) {
      if (it.y > 0.25) return;
      norm(it.s).split(/[^a-z]+/).forEach(function (w) { if (w.length >= 3) set[w] = true; });
    });
    return Object.keys(set).sort().slice(0, 80);
  }

  function similarity(a, b) {
    if (!a || !b || !a.length || !b.length) return 0;
    var inA = {};
    a.forEach(function (w) { inA[w] = true; });
    var both = 0;
    b.forEach(function (w) { if (inA[w]) both++; });
    return both / (a.length + b.length - both);
  }

  function compactId(s) { return String(s || '').replace(/[\s.\-]/g, '').toUpperCase(); }

  // info: { text, vatId, vendor, fingerprint } → { template, by: 'vat'|'name'|'header', score } | null
  function matchTemplate(templates, info) {
    var text = String(info.text || '');
    var compactText = compactId(text);
    var normText = norm(text);
    var vat = compactId(info.vatId);
    var vendor = norm(info.vendor);
    var best = null;
    (templates || []).forEach(function (t) {
      var m = null;
      if (t.vatId && (t.vatId === vat || (t.vatId.length >= 8 && compactText.indexOf(t.vatId) !== -1))) m = { by: 'vat', score: 3 };
      else if (t.nameKey && vendor && t.nameKey === vendor) m = { by: 'name', score: 2 };
      else if (t.nameKey && t.nameKey.length >= 6 && normText.indexOf(t.nameKey) !== -1) m = { by: 'name', score: 1.5 };
      else {
        var sim = similarity(t.fingerprint, info.fingerprint);
        if (sim >= 0.6) m = { by: 'header', score: sim };
      }
      if (m && (!best || m.score > best.score || (m.score === best.score && (t.updatedAt || '') > (best.template.updatedAt || '')))) {
        best = { template: t, by: m.by, score: m.score };
      }
    });
    return best;
  }

  // ---------- import / export hygiene ----------

  function num01(v) { return typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) : null; }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

  function cleanRegion(r) {
    if (!r || typeof r !== 'object') return null;
    var x = num01(r.x), y = num01(r.y), w = num01(r.w), h = num01(r.h);
    if (x == null || y == null || !w || !h) return null;
    var page = Math.round(+r.page);
    if (!(page >= 1 && page <= 999)) return null;
    var out = { page: page, x: x, y: y, w: w, h: h };
    var c = clampRect(out);
    out.x = c.x; out.y = c.y; out.w = c.w; out.h = c.h;
    if (r.anchor && typeof r.anchor === 'object' && typeof r.anchor.text === 'string' && r.anchor.text.trim()) {
      var ax = num01(r.anchor.x), ay = num01(r.anchor.y);
      if (ax != null && ay != null) out.anchor = { text: r.anchor.text.slice(0, 80), x: ax, y: ay };
    }
    if (typeof r.sample === 'string') out.sample = r.sample.slice(0, 200);
    if (typeof r.raw === 'string') out.raw = r.raw.slice(0, 400);
    if (r.src === 'template' || r.src === 'pdf' || r.src === 'ocr') out.src = r.src;
    return out;
  }

  function cleanRegions(obj) {
    var out = {};
    if (!obj || typeof obj !== 'object') return out;
    FIELD_KEYS.forEach(function (k) { var r = cleanRegion(obj[k]); if (r) out[k] = r; });
    return out;
  }

  function cleanTemplate(o) {
    if (!o || typeof o !== 'object') return null;
    var fields = {};
    FIELD_KEYS.forEach(function (k) {
      var r = cleanRegion(o.fields && o.fields[k]);
      if (r) { delete r.raw; delete r.src; fields[k] = r; }
    });
    if (!Object.keys(fields).length) return null;
    var name = str(o.name, 200).trim() || str(o.vendor, 200).trim();
    if (!name) return null;
    var vat = compactId(str(o.vatId, 30));
    return {
      id: /^[A-Za-z0-9\-_]{4,80}$/.test(o.id || '') ? o.id : null,
      name: name,
      vendor: str(o.vendor, 200).trim() || name,
      vatId: /^[A-Z0-9]{6,20}$/.test(vat) ? vat : '',
      nameKey: norm(str(o.nameKey, 200)) || norm(str(o.vendor, 200)) || norm(name),
      fingerprint: Array.isArray(o.fingerprint) ? o.fingerprint.filter(function (w) { return typeof w === 'string' && /^[a-z]{3,40}$/.test(w); }).slice(0, 80) : [],
      scanned: o.scanned === true,
      fields: fields,
      createdAt: str(o.createdAt, 40) || new Date().toISOString(),
      updatedAt: str(o.updatedAt, 40) || new Date().toISOString(),
      lastUsedAt: str(o.lastUsedAt, 40) || null,
      fixedBilledTo: /^[A-Za-z0-9\-_]{1,80}$/.test(o.fixedBilledTo || '') ? o.fixedBilledTo : '',
      fixedBilledPerson: /^[^\s@<>()",;]{1,100}@[^\s@<>()",;]{1,100}\.[a-z]{2,}$/i.test(o.fixedBilledPerson || '') ? String(o.fixedBilledPerson).toLowerCase() : '',
      uses: typeof o.uses === 'number' && o.uses >= 0 ? Math.floor(o.uses) : 0,
      lastInvoiceId: str(o.lastInvoiceId, 80) || null
    };
  }

  var api = {
    FIELDS: FIELDS,
    FIELD_KEYS: FIELD_KEYS,
    fieldInfo: fieldInfo,
    norm: norm,
    clampRect: clampRect,
    itemsFromTextContent: itemsFromTextContent,
    hasTextLayer: hasTextLayer,
    readingOrder: readingOrder,
    textInRect: textInRect,
    itemsInRect: itemsInRect,
    itemAt: itemAt,
    unionRect: unionRect,
    labelPart: labelPart,
    findAnchor: findAnchor,
    locate: locate,
    fingerprint: fingerprint,
    similarity: similarity,
    matchTemplate: matchTemplate,
    cleanRegion: cleanRegion,
    cleanRegions: cleanRegions,
    cleanTemplate: cleanTemplate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceRegions = api;
})(typeof window !== 'undefined' ? window : this);
