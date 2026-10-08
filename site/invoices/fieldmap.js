/* Adrial Apps · Invoices — PDF page viewer, "select fields on PDF", vendor templates, region OCR.
 *
 * Loaded before app.js; app.js calls InvoiceFieldMap.init(core) with its helpers and wires the hooks
 * (applyOnImport, onOpen, showDoc, collect, onClose …). Geometry lives in regions.js, text → value
 * parsing in parser.js (parseField). Templates are stored in IndexedDB 'adrial-invoices' → 'templates'.
 * All PDF / user text is inserted with textContent, never as HTML.
 */
(function () {
  'use strict';

  var R = window.InvoiceRegions;
  var P = window.InvoiceParser;
  var VIEW_KEY = 'adrial-invoices-viewer';
  var ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  var INPUT = {
    vendor: 'd-vendor', billedTo: 'd-company', billedPerson: 'd-person', vendorTaxId: 'd-taxid', number: 'd-number', issueDate: 'd-issue', dueDate: 'd-due',
    serviceDate: 'd-service', net: 'd-net', vat: 'd-vat', vatRate: 'd-rate', total: 'd-total', currency: 'd-cur',
    iban: 'd-iban', reference: 'd-ref', category: 'd-cat', poNumber: 'd-po'
  };
  var AMOUNT = { net: 1, vat: 1, total: 1 };
  var DATE = { issueDate: 1, dueDate: 1, serviceDate: 1 };
  var MORE_FIELDS = ['serviceDate', 'vatRate', 'iban', 'reference', 'poNumber'];
  var X_SVG = '<path d="M6 6l12 12M18 6 6 18"/>';

  function clamp01(n) { return Math.max(0, Math.min(1, n)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function oneLine(s, max) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > (max || 80) ? t.slice(0, (max || 80) - 1) + '…' : t;
  }
  function withTimeout(p, ms, msg) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(msg || 'timed out')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function init(core) {
    var $ = core.$;
    var el = core.el;
    var templates = [];
    var V = fresh();
    var drag = null;
    var OCR = { worker: null, p: null, cb: null, langs: '' };

    function loadZoom() {
      try { var z = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); return z && (z.zoom === 'fit' || ZOOMS.indexOf(z.zoom) !== -1) ? z.zoom : 'fit'; } catch (e) { return 'fit'; }
    }
    function saveZoom() { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ zoom: V.zoom })); } catch (e) { /* ignore */ } }

    function fresh() {
      return {
        inv: null, pdf: null, alive: function () { return false; }, page: 1, pages: 0, zoom: loadZoom(),
        items: {}, itemsP: {}, noText: {}, regions: {}, select: false, tpl: null, editing: false,
        pending: null, popFor: null, popReturn: null, renderSeq: 0, renderTask: null, stage: null, ov: null, pendingEdit: null, busy: false
      };
    }
    function parseOpts() { return { categories: core.state.settings.categories, companies: core.companies(), users: core.users() }; }
    function byId(id) { return templates.find(function (t) { return t.id === id; }) || null; }
    function live(msg) { var n = $('pv-live'); n.textContent = ''; setTimeout(function () { n.textContent = msg; }, 30); }
    function fieldLabel(f) { var i = R.fieldInfo(f); return i ? i.label : f; }

    // ---------- template storage ----------

    function setTemplates(list) { templates = (list || []).filter(function (t) { return t && t.id && t.fields; }); }
    function allTemplates() { return clone(templates); }
    async function putTemplate(t) {
      await core.idb.put('templates', t);
      var i = templates.findIndex(function (x) { return x.id === t.id; });
      if (i === -1) templates.push(t); else templates[i] = t;
    }
    async function noteTemplateUse(t, invId) {
      var cur = byId(t.id);
      if (!cur) return;
      cur.uses = (cur.uses || 0) + 1;
      cur.lastUsedAt = new Date().toISOString();
      if (invId) cur.lastInvoiceId = invId;
      try { await core.idb.put('templates', cur); } catch (e) { /* usage stats are not critical */ }
    }
    async function importTemplates(list, opts) {
      var n = 0;
      for (var i = 0; i < (list || []).length; i++) {
        var t = R.cleanTemplate(list[i]);
        if (!t) continue;
        if (!t.id) t.id = core.uid();
        if (byId(t.id) && opts && opts.keepExisting) continue;
        await putTemplate(t);
        n++;
      }
      return n;
    }

    // ---------- reading with a template ----------

    function setParsed(parsed, f, v, pr) {
      parsed[f] = v;
      if (f === 'billedPerson' && pr && pr.name) parsed.billedPersonName = pr.name;
    }
    // names read for emails in this dialog, used when a new person is added on save
    var personNames = {};
    function personName(email) { return personNames[String(email || '').toLowerCase()] || ''; }

    // pagesItems: array (page 1 first) of text items; pages without text yield raw ''
    function readWithTemplate(t, pagesItems) {
      var values = {};
      var regions = {};
      Object.keys(t.fields).forEach(function (f) {
        var reg = t.fields[f];
        var loc = R.locate(reg, pagesItems);
        var items = pagesItems[loc.page - 1];
        var raw = items ? R.textInRect(items, loc) : '';
        if (!raw && loc.anchored && pagesItems[reg.page - 1]) {
          loc = { page: reg.page, x: reg.x, y: reg.y, w: reg.w, h: reg.h };
          raw = R.textInRect(pagesItems[reg.page - 1], loc);
        }
        regions[f] = { page: loc.page, x: loc.x, y: loc.y, w: loc.w, h: loc.h, raw: raw.slice(0, 400), src: 'template' };
        values[f] = P.parseField(f, raw, parseOpts());
      });
      return { values: values, regions: regions };
    }

    // on upload: matched template first, parser for the rest. Mutates parsed.
    function applyOnImport(parsed, ext) {
      if (!templates.length || !parsed || parsed.scanned || !ext || !ext.items || !ext.items.length) return null;
      var m = R.matchTemplate(templates, { text: (ext.lines || []).join('\n'), vatId: parsed.vendorTaxId, vendor: parsed.vendor, fingerprint: R.fingerprint(ext.items[0]) });
      if (!m) return null;
      var t = m.template;
      var res = readWithTemplate(t, ext.items);
      var fields = [];
      parsed.confidence = parsed.confidence || {};
      Object.keys(res.values).forEach(function (f) {
        var pr = res.values[f];
        if (!pr.ok) return;
        setParsed(parsed, f, pr.value, pr);
        parsed.confidence[f] = 'template';
        fields.push(f);
      });
      if (t.fixedBilledPerson) {
        parsed.billedPerson = t.fixedBilledPerson;
        parsed.confidence.billedPerson = 'template';
        if (fields.indexOf('billedPerson') === -1) fields.push('billedPerson');
      }
      if (fields.indexOf('vendor') === -1 && t.vendor) { parsed.vendor = t.vendor; parsed.confidence.vendor = 'template'; }
      if (t.fixedBilledTo && core.companyById(t.fixedBilledTo)) {
        parsed.billedTo = t.fixedBilledTo;
        parsed.confidence.billedTo = 'template';
        if (fields.indexOf('billedTo') === -1) fields.push('billedTo');
      }
      if (fields.indexOf('category') === -1 && fields.length) {
        var cat = P.guessCategory(parsed.vendor, (ext.lines || []).join('\n'), null);
        if (parsed.category === 'Other' && cat !== 'Other') parsed.category = cat;
      }
      return { template: t, by: m.by, fields: fields, regions: res.regions };
    }

    // ---------- detail dialog lifecycle ----------

    function clearSources() { document.querySelectorAll('#detail .src-hint').forEach(function (n) { n.remove(); }); }

    function onOpen(inv) {
      closePop();
      if (V.select) setSelect(false, true);
      var pendingEdit = V.pendingEdit;
      V = fresh();
      V.pendingEdit = pendingEdit;
      V.inv = inv;
      V.regions = R.cleanRegions(inv.regions || {});
      V.tpl = inv.templateId ? byId(inv.templateId) : null;
      clearSources();
      Object.keys(V.regions).forEach(function (f) { showSource(f, V.regions[f]); });
      $('d-more').open = MORE_FIELDS.some(function (f) { return inv[f] != null && inv[f] !== ''; });
      $('pv-bar').hidden = true;
      $('pv-save').hidden = true;
      $('pv-help').hidden = true;
      $('pv-list').hidden = true;
      $('pv-list-btn').setAttribute('aria-expanded', 'false');
      $('pv-save').dataset.touched = '';
      $('pv-save').dataset.touchedPerson = '';
      $('pv-fixco').checked = false;
      $('pv-fixperson').checked = false;
      personNames = {};
      renderTplNote();
    }

    function onClose() {
      closePop();
      drag = null;
      V.alive = function () { return false; };
      if (V.renderTask) { try { V.renderTask.cancel(); } catch (e) { /* ignore */ } }
      V = fresh();
      clearSources();
      $('d-tpl').hidden = true;
      if (OCR.worker) { try { OCR.worker.terminate(); } catch (e) { /* ignore */ } }
      OCR.worker = null; OCR.p = null;
    }

    function previewFailed() { $('pv-bar').hidden = true; }

    async function showDoc(inv, pdf, alive) {
      if (V.inv !== inv) return;
      V.pdf = pdf;
      V.pages = pdf.numPages;
      V.alive = alive;
      $('pv-bar').hidden = false;
      var first = 1;
      if (V.pendingEdit) {
        var t = byId(V.pendingEdit);
        var pages = t ? Object.keys(t.fields).map(function (f) { return t.fields[f].page; }) : [1];
        first = Math.min.apply(null, pages) || 1;
      }
      await renderPage(Math.min(first, V.pages));
      if (!alive()) return;
      await ensureItems(1);
      if (!alive()) return;
      renderTplNote();
      updateSaveBar();
      if (V.pendingEdit) {
        var tp = byId(V.pendingEdit);
        V.pendingEdit = null;
        if (tp) { V.tpl = tp; await editTemplate(); }
      }
    }

    // ---------- page rendering ----------

    async function ensureItems(n) {
      if (V.items[n]) return V.items[n];
      if (!V.itemsP[n]) {
        var pdf = V.pdf;
        // photos: the OCR word boxes stored with the invoice are the text layer
        if (pdf.pageItems) {
          var own = pdf.pageItems[n - 1] || [];
          V.items[n] = own;
          V.noText[n] = !R.hasTextLayer(own);
          V.itemsP[n] = Promise.resolve(own);
          return own;
        }
        V.itemsP[n] = pdf.getPage(n).then(function (page) {
          return page.getTextContent().then(function (tc) {
            var items = R.itemsFromTextContent(tc.items, page.getViewport({ scale: 1 }));
            if (V.pdf === pdf) { V.items[n] = items; V.noText[n] = !R.hasTextLayer(items); }
            return items;
          });
        }).catch(function () { if (V.pdf === pdf) { V.items[n] = []; V.noText[n] = true; } return []; });
      }
      return V.itemsP[n];
    }

    async function allPageItems() {
      var out = [];
      for (var p = 1; p <= Math.min(V.pages, 15); p++) out.push(await ensureItems(p));
      return out;
    }

    function buildStage() {
      var holder = $('d-pages');
      holder.textContent = '';
      var stage = el('div', { class: 'pv-stage' });
      var ov = el('div', { class: 'pv-ov' + (V.select ? ' on' : '') });
      stage.append(ov);
      holder.append(stage);
      V.stage = stage;
      V.ov = ov;
      ov.addEventListener('pointerdown', onDown);
      ov.addEventListener('pointermove', onMove);
      ov.addEventListener('pointerup', onUp);
      ov.addEventListener('pointercancel', onCancel);
      ov.addEventListener('pointerleave', function () { if (!drag) hideHover(); });
      ov.addEventListener('click', function (e) {
        var x = e.target.closest('.rgn-x');
        if (x) { e.stopPropagation(); removeRegion(x.closest('.rgn').dataset.field, true); }
      });
      ov.addEventListener('keydown', onRegionKey);
    }

    async function renderPage(n) {
      if (!V.pdf || n < 1 || n > V.pages) return;
      var seq = ++V.renderSeq;
      var pdf = V.pdf;
      V.page = n;
      closePop();
      $('pv-pg').textContent = n + ' / ' + V.pages;
      $('pv-prev').disabled = n <= 1;
      $('pv-next').disabled = n >= V.pages;
      $('pv-zfit').textContent = V.zoom === 'fit' ? 'Fit' : Math.round(V.zoom * 100) + '%';
      $('pv-zout').disabled = V.zoom !== 'fit' && V.zoom <= ZOOMS[0];
      $('pv-zin').disabled = V.zoom !== 'fit' && V.zoom >= ZOOMS[ZOOMS.length - 1];
      if (!V.stage || !V.stage.isConnected) buildStage();
      var page = await pdf.getPage(n);
      if (seq !== V.renderSeq || !V.alive()) return;
      var base = page.getViewport({ scale: 1 });
      var avail = Math.max(240, ($('d-preview').clientWidth || 552) - 32);
      var fit = Math.min(avail, 900);
      var cssW = Math.round(fit * (V.zoom === 'fit' ? 1 : V.zoom));
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var scale = Math.min((cssW / base.width) * dpr, 4096 / base.width);
      var vp = page.getViewport({ scale: scale });
      var canvas = el('canvas', { role: 'img', 'aria-label': 'Page ' + n + ' of ' + V.pages });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      if (V.renderTask) { try { V.renderTask.cancel(); } catch (e) { /* ignore */ } }
      var task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      V.renderTask = task;
      try { await task.promise; } catch (e) { if (seq === V.renderSeq) console.warn(e); return; }
      if (seq !== V.renderSeq || !V.alive()) return;
      V.stage.style.width = cssW + 'px';
      var old = V.stage.querySelector('canvas');
      if (old) old.replaceWith(canvas); else V.stage.prepend(canvas);
      await ensureItems(n);
      if (seq !== V.renderSeq || !V.alive()) return;
      var note = $('d-pages').querySelector('.pv-notext');
      if (V.noText[n]) {
        if (!note) $('d-pages').prepend(el('p', { class: 'pv-notext', text: 'This page has no text layer (scan). Select fields on PDF, draw a box around a value and read it with OCR.' }));
      } else if (note) note.remove();
      drawRegions();
      refreshItemList();
    }

    function setZoom(z) {
      V.zoom = z;
      saveZoom();
      if (V.pdf) renderPage(V.page);
    }
    function zoomStep(dir) {
      var cur = V.zoom === 'fit' ? 1 : V.zoom;
      var next = dir > 0 ? ZOOMS.find(function (z) { return z > cur + 1e-6; }) : ZOOMS.slice().reverse().find(function (z) { return z < cur - 1e-6; });
      if (next) setZoom(next === 1 ? 'fit' : next);
    }

    // ---------- regions on the page ----------

    function regionEl(f, r, interactive) {
      var info = R.fieldInfo(f);
      var box = el('div', {
        class: 'rgn' + (r.y < 0.035 ? ' lbl-in' : ''),
        'data-field': f,
        tabindex: interactive ? '0' : null,
        role: interactive ? 'button' : null,
        'aria-label': interactive ? info.label + ' box. Arrow keys move it, Shift and arrows resize, Enter changes the field, Delete removes it.' : null,
        style: '--c:' + info.color + ';--cf:' + rgba(info.color, 0.13) + ';left:' + (r.x * 100) + '%;top:' + (r.y * 100) + '%;width:' + (r.w * 100) + '%;height:' + (r.h * 100) + '%'
      });
      var lbl = el('span', { class: 'rgn-lbl' }, [info.label + (r.src === 'template' ? ' · template' : r.src === 'ocr' ? ' · OCR' : '')]);
      if (interactive) {
        var x = el('button', { type: 'button', class: 'rgn-x', 'aria-label': 'Remove the ' + info.label + ' box', tabindex: '-1' });
        x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + X_SVG + '</svg>';
        lbl.append(x);
        box.append(lbl, el('span', { class: 'rgn-h', 'aria-hidden': 'true' }));
      } else box.append(lbl);
      return box;
    }

    function drawRegions() {
      var ov = V.ov;
      if (!ov) return;
      ov.querySelectorAll('.rgn').forEach(function (n) { n.remove(); });
      Object.keys(V.regions).forEach(function (f) {
        var r = V.regions[f];
        if (r.page === V.page) ov.append(regionEl(f, r, V.select));
      });
    }

    function positionEl(node, r) {
      node.style.left = (r.x * 100) + '%';
      node.style.top = (r.y * 100) + '%';
      node.style.width = (r.w * 100) + '%';
      node.style.height = (r.h * 100) + '%';
    }

    function hideHover() { var h = V.ov && V.ov.querySelector('.pv-hover'); if (h) h.remove(); }
    function showHover(rect) {
      if (!V.ov) return;
      var h = V.ov.querySelector('.pv-hover');
      if (!rect) { if (h) h.remove(); return; }
      if (!h) { h = el('div', { class: 'pv-hover' }); V.ov.append(h); }
      positionEl(h, rect);
    }

    function pt(e) {
      var r = V.ov.getBoundingClientRect();
      return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
    }
    function rectFrom(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }

    function onDown(e) {
      if (!V.select || (e.button != null && e.button > 0)) return;
      if (e.target.closest('.rgn-x')) return;
      var rg = e.target.closest('.rgn');
      var p = pt(e);
      var field = rg ? rg.dataset.field : null;
      drag = {
        id: e.pointerId, start: p, sx: e.clientX, sy: e.clientY, moved: false, field: field, el: rg,
        mode: rg ? (e.target.closest('.rgn-h') ? 'resize' : 'move') : 'draw',
        orig: field ? clone(V.regions[field]) : null, draft: null
      };
      try { V.ov.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
      closePop();
      hideHover();
      if (drag.mode === 'draw') { drag.draft = el('div', { class: 'pv-draft' }); positionEl(drag.draft, { x: p.x, y: p.y, w: 0, h: 0 }); V.ov.append(drag.draft); }
    }

    function onMove(e) {
      if (!V.select) return;
      var p = pt(e);
      if (!drag) {
        if (e.pointerType === 'mouse' && !e.target.closest('.rgn')) {
          var it = R.itemAt(V.items[V.page], p.x, p.y);
          showHover(it ? R.unionRect([it]) : null);
        }
        return;
      }
      if (e.pointerId !== drag.id) return;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
      var dx = p.x - drag.start.x;
      var dy = p.y - drag.start.y;
      if (drag.mode === 'draw') positionEl(drag.draft, rectFrom(drag.start, p));
      else if (drag.moved) {
        var o = drag.orig;
        var r = drag.mode === 'move' ? R.clampRect({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }) : R.clampRect({ x: o.x, y: o.y, w: Math.max(0.006, o.w + dx), h: Math.max(0.005, o.h + dy) });
        var cur = V.regions[drag.field];
        cur.x = r.x; cur.y = r.y; cur.w = r.w; cur.h = r.h;
        positionEl(drag.el, cur);
      }
    }

    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;
      try { V.ov.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var p = pt(e);
      if (d.mode === 'draw') {
        if (d.draft) d.draft.remove();
        var rect;
        if (!d.moved) {
          var it = R.itemAt(V.items[V.page], p.x, p.y);
          if (!it) { if (V.noText[V.page]) live('Drag a box around the area, then read it with OCR.'); return; }
          rect = R.unionRect([it]);
        } else {
          rect = R.clampRect(rectFrom(d.start, p));
          if (rect.w < 0.006 || rect.h < 0.005) return;
        }
        openPop({ page: V.page, x: rect.x, y: rect.y, w: rect.w, h: rect.h }, null, null);
      } else if (!d.moved) {
        openPop(V.regions[d.field], d.field, d.el);
      } else {
        regionChanged(d.field);
      }
    }

    function onCancel(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.draft) drag.draft.remove();
      if (drag.orig && V.regions[drag.field]) { Object.assign(V.regions[drag.field], drag.orig); positionEl(drag.el, drag.orig); }
      drag = null;
    }

    var keyTimer = null;
    function onRegionKey(e) {
      var rg = e.target.closest('.rgn');
      if (!rg || !V.select || e.target.closest('.rgn-x')) return;
      var f = rg.dataset.field;
      var r = V.regions[f];
      if (!r) return;
      var step = e.altKey ? 0.001 : 0.005;
      var map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (map[e.key]) {
        e.preventDefault();
        var m = map[e.key];
        var n = e.shiftKey ? R.clampRect({ x: r.x, y: r.y, w: Math.max(0.006, r.w + m[0] * step), h: Math.max(0.005, r.h + m[1] * step) })
          : R.clampRect({ x: r.x + m[0] * step, y: r.y + m[1] * step, w: r.w, h: r.h });
        r.x = n.x; r.y = n.y; r.w = n.w; r.h = n.h;
        positionEl(rg, r);
        clearTimeout(keyTimer);
        keyTimer = setTimeout(function () { regionChanged(f); }, 350);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPop(r, f, rg);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeRegion(f, true);
      }
    }

    function regionChanged(f) {
      var r = V.regions[f];
      if (!r) return;
      if (V.noText[r.page]) {
        live(fieldLabel(f) + ' box moved. Select it and use OCR to read it again.');
        return;
      }
      r.raw = R.textInRect(V.items[r.page], r).slice(0, 400);
      if (r.src === 'template') r.src = 'pdf';
      drawRegions();
      applyField(f, r);
      focusRegion(f);
      updateSaveBar();
    }

    function focusRegion(f) {
      if (!V.ov || !V.select) return;
      var n = V.ov.querySelector('.rgn[data-field="' + f + '"]');
      if (n) n.focus({ preventScroll: true });
    }

    function removeRegion(f, announce) {
      if (!V.regions[f]) return;
      delete V.regions[f];
      var c = $(INPUT[f]) && $(INPUT[f]).closest('.f');
      var hint = c && c.querySelector('.src-hint');
      if (hint) hint.remove();
      drawRegions();
      updateSaveBar();
      if (announce) live(fieldLabel(f) + ' box removed. The value in the field stays as it is.');
      if (V.select) $('pv-select').focus();
    }

    async function gotoRegion(f) {
      var r = V.regions[f];
      if (!r || !V.pdf) return;
      if (r.page !== V.page) await renderPage(r.page);
      var n = V.ov && V.ov.querySelector('.rgn[data-field="' + f + '"]');
      if (!n) return;
      n.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      n.classList.remove('flash');
      void n.offsetWidth;
      n.classList.add('flash');
      if (V.select) n.focus({ preventScroll: true });
    }

    // ---------- writing values into the form ----------

    function writeField(f, v) {
      var input = $(INPUT[f]);
      if (!input || v == null) return;
      var s;
      if (AMOUNT[f]) s = core.amountText(v);
      else if (DATE[f]) s = v;
      else if (f === 'vatRate') s = String(v).replace('.', ',');
      else if (f === 'iban') s = core.formatIban(v);
      else s = String(v);
      if (f === 'currency' && !Array.from(input.options).some(function (o) { return o.value === s; })) input.append(el('option', { value: s, text: s }));
      if (f === 'category' && !Array.from(input.options).some(function (o) { return o.value === s; })) core.fillCategorySelect(input, s);
      if (f === 'billedTo' && !core.companyById(s)) return;
      input.value = s;
      if (MORE_FIELDS.indexOf(f) !== -1) $('d-more').open = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      var tag = document.querySelector('#detail .tag[data-for="' + f + '"]');
      if (tag) tag.hidden = true;
      if (f === 'billedTo') $('d-company-hint').textContent = 'Read from the box on the PDF.';
      if (f === 'billedTo' || f === 'billedPerson') core.personHint();
    }

    function display(f, v) {
      if (v == null || v === '') return '–';
      if (DATE[f]) return core.dateStr(v);
      if (AMOUNT[f]) return core.amountText(v);
      if (f === 'vatRate') return String(v).replace('.', ',') + ' %';
      if (f === 'billedTo') return core.companyLabel(v);
      if (f === 'billedPerson') return core.personLabel(v) + ' <' + v + '>';
      if (f === 'iban') return core.formatIban(v);
      return String(v);
    }

    function applyField(f, r, quiet) {
      var pr = P.parseField(f, r.raw, parseOpts());
      if (pr.ok && f === 'billedPerson' && pr.name) personNames[pr.value] = pr.name;
      if (pr.ok) writeField(f, pr.value);
      showSource(f, r, pr);
      core.syncDetailUi();
      if (!quiet) live(pr.ok ? fieldLabel(f) + ' set to ' + display(f, pr.value) + '.' : fieldLabel(f) + ': no value could be read from this box. Type it in.');
      return pr;
    }

    function showSource(f, r, pr) {
      var input = $(INPUT[f]);
      var c = input && input.closest('.f');
      if (!c) return;
      var hint = c.querySelector('.src-hint');
      if (!hint) { hint = el('span', { class: 'src-hint' }); c.append(hint); }
      hint.textContent = '';
      var info = R.fieldInfo(f);
      var dot = el('i', { 'aria-hidden': 'true', style: '--c:' + info.color });
      var from = r.src === 'template' ? 'From template' : r.src === 'ocr' ? 'From OCR' : 'From PDF';
      hint.append(dot, el('span', { text: from + ':' }), el('span', { class: 'q', title: r.raw || '', text: r.raw ? '“' + oneLine(r.raw, 70) + '”' : '(empty box)' }));
      if (pr && !pr.ok) hint.append(el('span', { class: 'warn', text: '· not understood' }));
      else if (pr && pr.warn) hint.append(el('span', { class: 'warn', text: '· ' + pr.warn }));
      hint.append(el('button', { type: 'button', text: 'Show', 'aria-label': 'Show the ' + info.label + ' box on the PDF', onclick: function () { gotoRegion(f); } }));
    }

    // ---------- the "which field is this?" popover ----------

    function guessField(raw) {
      var t = String(raw || '');
      if (!t.trim()) return null;
      var n = P.norm(t);
      if (P.parseField('iban', t).ok && !P.parseField('iban', t).warn) return 'iban';
      if (/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+\.[A-Za-z]{2,}/.test(t)) return 'billedPerson';
      if (core.companies().length && P.findBilledTo(t.split('\n'), core.companies()).id && /kupec|prejemnik|narocnik|racun za|bill|buyer|customer|kupac|primatelj/.test(n)) return 'billedTo';
      if (/sklic|referenc|model|poziv/.test(n)) return 'reference';
      if (/narocil|purchase order|\bpo\b|order no|narudzb/.test(n)) return 'poNumber';
      if (P.findDates(t).length) {
        if (/rok|due|zapad|valuta|dospij|fallig/.test(n)) return 'dueDate';
        if (/storitv|dobav|delivery|service|opravlj|leistung|obdobje|period/.test(n)) return 'serviceDate';
        return 'issueDate';
      }
      if (/%/.test(t) && !/[.,]\d{2}\b(?!\s*%)/.test(t.replace(/\d+[.,]?\d*\s*%/g, ''))) return 'vatRate';
      if (/\b(ddv|vat|pdv|ust|oib|uid)\b.*\d{6}|\b[A-Z]{2}\s?\d{8,12}\b/i.test(t) && !/[.,]\d{2}(?!\d)/.test(t)) return 'vendorTaxId';
      if (P.moneyIn(t).length || /^\s*-?[\d.,\s]+\s*(€|eur)?\s*$/i.test(t)) {
        if (/skupaj|total|placilo|ukupno|amount due|zu zahlen|brutto|bruto/.test(n)) return 'total';
        if (/osnova|neto|netto|\bnet\b|brez|excl|subtotal/.test(n)) return 'net';
        if (/\b(ddv|vat|pdv|mwst|tax)\b/.test(n)) return 'vat';
        return 'total';
      }
      if (/racun|invoice|faktur|rechnung|dobropis/.test(n) && /\d/.test(t)) return 'number';
      if (/^\s*(eur|usd|gbp|chf|€|\$|£)\s*$/i.test(t)) return 'currency';
      if (/\d/.test(t) && /^[A-Z0-9][A-Z0-9\-\/._]{2,30}$/i.test(t.trim())) return 'number';
      if (/[a-z]{3}/i.test(t) && !/\d/.test(t)) return 'vendor';
      return null;
    }

    function openPop(rect, field, returnEl) {
      var pop = $('pv-pop');
      var items = V.items[rect.page] || [];
      var noText = !!V.noText[rect.page];
      var raw = field && V.regions[field] ? (V.regions[field].raw || '') : (noText ? '' : R.textInRect(items, rect));
      V.pending = { page: rect.page, x: rect.x, y: rect.y, w: rect.w, h: rect.h, raw: raw, src: field && V.regions[field] ? V.regions[field].src : (noText ? 'ocr' : 'pdf') };
      V.popFor = field;
      V.popReturn = returnEl || document.activeElement;
      if (!field && V.ov) {
        var d = V.ov.querySelector('.pv-draft.keep');
        if (!d) { d = el('div', { class: 'pv-draft keep' }); V.ov.append(d); }
        positionEl(d, rect);
      }
      $('pv-pop-title').textContent = field ? 'Change the field for this box' : 'Which field is this?';
      setPopText(raw, noText);
      $('pv-pop-ocr').hidden = !(noText || !raw);
      $('pv-pop-ocr-btn').disabled = false;
      $('pv-pop-prog').hidden = true;
      $('pv-pop-ocr-msg').textContent = noText ? 'This page is a scan.' : '';
      $('pv-pop-remove').hidden = !field;
      renderFieldButtons(field, guessField(raw));
      pop.hidden = false;
      placePop(rect);
      var first = pop.querySelector('.fbtn.sug') || pop.querySelector('.fbtn[aria-pressed="true"]') || (noText && !raw ? $('pv-pop-ocr-btn') : pop.querySelector('.fbtn'));
      if (first) first.focus({ preventScroll: true });
    }

    function setPopText(raw, noText) {
      var p = $('pv-pop-text');
      p.className = 'pv-pop-text' + (raw ? '' : ' empty');
      p.textContent = raw || (noText ? 'No text layer here. Read this area with OCR, or choose the field and type the value in.' : 'No text found in this box.');
    }

    function renderFieldButtons(current, suggested) {
      var box = $('pv-pop-fields');
      box.textContent = '';
      R.FIELDS.forEach(function (fi) {
        var mapped = V.regions[fi.key] && fi.key !== current;
        var b = el('button', {
          type: 'button', class: 'fbtn' + (fi.key === suggested ? ' sug' : ''), 'data-field': fi.key, style: '--c:' + fi.color,
          'aria-pressed': fi.key === current ? 'true' : 'false',
          onclick: function () { choose(fi.key); }
        }, [el('i', { 'aria-hidden': 'true' }), fi.label]);
        if (fi.key === suggested) b.append(el('small', { text: 'suggested' }));
        else if (mapped) b.append(el('small', { text: 'replace' }));
        box.append(b);
      });
    }

    function placePop(rect) {
      var pop = $('pv-pop');
      if (window.innerWidth <= 600) { pop.style.left = ''; pop.style.top = ''; return; }
      var o = V.ov ? V.ov.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: 0 };
      var rl = o.left + rect.x * o.width;
      var rt = o.top + rect.y * o.height;
      var rb = rt + rect.h * o.height;
      var pw = pop.offsetWidth;
      var ph = pop.offsetHeight;
      var top = rb + 8;
      if (top + ph > window.innerHeight - 8) top = rt - ph - 8;
      if (top < 8) top = Math.max(8, window.innerHeight - ph - 8);
      var left = Math.min(Math.max(12, rl), window.innerWidth - pw - 12);
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
    }

    function closePop(silent) {
      var pop = $('pv-pop');
      var wasOpen = pop && !pop.hidden;
      var hadFocus = wasOpen && pop.contains(document.activeElement);
      if (pop) pop.hidden = true;
      if (V.ov) V.ov.querySelectorAll('.pv-draft').forEach(function (n) { n.remove(); });
      V.pending = null;
      V.popFor = null;
      if (hadFocus && !silent) {
        var back = V.popReturn && V.popReturn.isConnected && V.popReturn !== document.body ? V.popReturn : $('pv-select');
        back.focus({ preventScroll: true });
      }
    }

    function choose(f) {
      var p = V.pending;
      if (!p) return;
      var old = V.popFor;
      if (old && old !== f) removeRegion(old, false);
      var r = { page: p.page, x: p.x, y: p.y, w: p.w, h: p.h, raw: (p.raw || '').slice(0, 400), src: p.src === 'template' && old === f ? 'template' : (p.src === 'ocr' ? 'ocr' : 'pdf') };
      V.regions[f] = r;
      closePop(true);
      drawRegions();
      applyField(f, r);
      updateSaveBar();
      if (V.select) focusRegion(f); else $('pv-list-btn').focus();
    }

    // ---------- OCR (tesseract.js, loaded only when asked) ----------

    function getWorker(cb) {
      OCR.cb = cb;
      if (OCR.worker) return Promise.resolve(OCR.worker);
      if (OCR.p) return OCR.p;
      OCR.p = (async function () {
        await core.loadScript(core.TESSERACT_URL);
        if (!window.Tesseract || !window.Tesseract.createWorker) throw new Error('the OCR library did not start');
        var logger = function (m) { if (OCR.cb) OCR.cb(m); };
        var w;
        try {
          w = await withTimeout(window.Tesseract.createWorker('eng+slv+hrv', 1, { logger: logger }), 120000, 'loading the languages timed out');
          OCR.langs = 'eng+slv+hrv';
        } catch (e) {
          w = await withTimeout(window.Tesseract.createWorker('eng', 1, { logger: logger }), 120000, 'loading the language timed out');
          OCR.langs = 'eng';
        }
        OCR.worker = w;
        return w;
      })();
      OCR.p.catch(function () { OCR.p = null; });
      return OCR.p;
    }

    async function ocrRect(pdf, rect, cb) {
      var w = await getWorker(cb);
      var page = await pdf.getPage(rect.page);
      var base = page.getViewport({ scale: 1 });
      // PDFs are in points (render 2.5–5×); photos are already in pixels, so at most 2×
      var S = pdf.kind === 'image' ? Math.min(2, Math.max(1, 1200 / Math.max(1, rect.w * base.width))) : Math.min(5, Math.max(2.5, 1600 / Math.max(1, rect.w * base.width)));
      var fullW = base.width * S;
      var fullH = base.height * S;
      var cw = Math.max(8, Math.ceil(rect.w * fullW));
      var ch = Math.max(8, Math.ceil(rect.h * fullH));
      var crop = document.createElement('canvas');
      crop.width = cw; crop.height = ch;
      var ctx = crop.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cw, ch);
      var vp = page.getViewport({ scale: S, offsetX: -rect.x * fullW, offsetY: -rect.y * fullH });
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      var padded = document.createElement('canvas');
      padded.width = cw + 40; padded.height = ch + 40;
      var pctx = padded.getContext('2d');
      pctx.fillStyle = '#fff';
      pctx.fillRect(0, 0, padded.width, padded.height);
      pctx.drawImage(crop, 20, 20);
      if (cb) cb({ status: 'recognizing text', progress: 0 });
      var res = await w.recognize(padded);
      return String((res && res.data && res.data.text) || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    }

    function ocrMessage(e) {
      var m = String((e && e.message) || e || '');
      if (/load|fetch|network|failed/i.test(m)) return 'OCR could not load — you may be offline. Type the value into the field instead.';
      return 'OCR did not work here (' + oneLine(m, 80) + '). Type the value into the field instead.';
    }

    function progressText(m) {
      var s = String(m && m.status || '');
      if (/core/.test(s)) return 'Loading OCR…';
      if (/traineddata|language/.test(s)) return 'Loading languages…';
      if (/initiali/.test(s)) return 'Starting OCR…';
      if (/recogniz/.test(s)) return 'Reading…';
      return 'Working…';
    }

    async function ocrPending() {
      var p = V.pending;
      if (!p || !V.pdf) return;
      var btn = $('pv-pop-ocr-btn');
      var prog = $('pv-pop-prog');
      var msg = $('pv-pop-ocr-msg');
      btn.disabled = true;
      prog.hidden = false;
      prog.removeAttribute('value');
      msg.textContent = OCR.worker ? 'Reading…' : 'Loading OCR (the first time takes a while)…';
      try {
        var text = await ocrRect(V.pdf, p, function (m) {
          if (V.pending !== p) return;
          msg.textContent = progressText(m);
          if (typeof m.progress === 'number') prog.value = m.progress;
        });
        if (V.pending !== p) return;
        p.raw = text;
        p.src = 'ocr';
        setPopText(text, true);
        prog.hidden = true;
        msg.textContent = text ? 'Read with OCR (' + OCR.langs + '). Check the text, then choose the field.' : 'OCR found no text in this area.';
        renderFieldButtons(V.popFor, guessField(text));
        var sug = $('pv-pop').querySelector('.fbtn.sug') || $('pv-pop').querySelector('.fbtn');
        if (sug) sug.focus({ preventScroll: true });
        btn.disabled = false;
        btn.textContent = 'Read again (OCR)';
      } catch (e) {
        console.warn(e);
        if (V.pending !== p) return;
        prog.hidden = true;
        msg.textContent = ocrMessage(e);
        btn.disabled = false;
      }
    }

    // ---------- select mode, text list ----------

    function setSelect(on, silent) {
      V.select = !!on;
      $('pv-select').setAttribute('aria-pressed', V.select ? 'true' : 'false');
      $('pv-select').textContent = V.select ? 'Done selecting' : 'Select fields on PDF';
      $('pv-help').hidden = !V.select;
      $('d-preview').classList.toggle('selecting', V.select);
      if (V.ov) V.ov.classList.toggle('on', V.select);
      if (!V.select) { closePop(true); hideHover(); V.editing = false; }
      drawRegions();
      updateSaveBar();
      if (V.select && !silent) {
        $('pv-help').textContent = V.editing && V.tpl
          ? 'Editing template “' + V.tpl.name + '”: move, resize, add or remove boxes, then choose Update template.'
          : 'Drag a box around a value on the page, or click a single word, then choose which field it is. Drag a box to move it, its corner to resize it.';
        if (window.innerWidth <= 900) $('d-preview').scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }

    function refreshItemList() {
      var sel = $('pv-items');
      if (!sel) return;
      sel.textContent = '';
      var items = V.items[V.page] || [];
      if (V.noText[V.page] || !items.length) {
        sel.append(el('option', { disabled: true, text: 'No text on this page (scan). Use Select fields on PDF and OCR.' }));
        $('pv-assign').disabled = true;
        return;
      }
      $('pv-assign').disabled = false;
      R.readingOrder(items).forEach(function (row) {
        row.items.forEach(function (it) {
          sel.append(el('option', { value: String(items.indexOf(it)), text: oneLine(it.s, 90) }));
        });
      });
    }

    function assignFromList() {
      var sel = $('pv-items');
      var items = V.items[V.page] || [];
      var picked = Array.from(sel.selectedOptions).map(function (o) { return items[+o.value]; }).filter(Boolean);
      if (!picked.length) { live('Choose one or more pieces of text first.'); sel.focus(); return; }
      var f = $('pv-field').value;
      var rect = R.unionRect(picked);
      V.pending = { page: V.page, x: rect.x, y: rect.y, w: rect.w, h: rect.h, raw: R.textInRect(picked, rect), src: 'pdf' };
      V.popFor = null;
      choose(f);
      hideHover();
      sel.focus();
    }

    // ---------- save as template ----------

    function vendorName() { return $('d-vendor').value.trim(); }

    function updateSaveBar() {
      if (!V.inv) return;
      var n = Object.keys(V.regions).length;
      var bar = $('pv-save');
      bar.hidden = n === 0 || !V.pdf;
      if (bar.hidden) return;
      var v = vendorName();
      var existing = V.tpl && byId(V.tpl.id);
      $('pv-save-note').textContent = core.plural(n, 'field', 'fields') + ' mapped on the PDF' + (existing ? ' · template “' + existing.name + '”' : '');
      $('pv-save-btn').textContent = existing ? 'Update template' : 'Save as template for ' + (v ? oneLine(v, 40) : 'this vendor');
      var co = $('d-company').value;
      $('pv-fixco-row').hidden = !co;
      if (co) {
        $('pv-fixco-label').textContent = 'Always ' + core.companyLabel(co) + ' for this vendor';
        if (existing && !bar.dataset.touched) $('pv-fixco').checked = existing.fixedBilledTo === co;
      }
      var who = $('d-person').value.trim().toLowerCase();
      var okWho = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(who);
      $('pv-fixperson-row').hidden = !okWho;
      if (okWho) {
        $('pv-fixperson-label').textContent = 'Always ' + core.personLabel(who) + ' for this vendor';
        if (existing && !bar.dataset.touchedPerson) $('pv-fixperson').checked = existing.fixedBilledPerson === who;
      }
    }

    async function saveTemplate() {
      var vendor = vendorName();
      if (!vendor) { core.toast('Enter the vendor name first — the template is saved under it.'); $('d-vendor').focus(); return; }
      var keys = Object.keys(V.regions);
      if (!keys.length) return;
      for (var i = 0; i < keys.length; i++) await ensureItems(V.regions[keys[i]].page);
      await ensureItems(1);
      var vat = $('d-taxid').value.replace(/[\s.\-]/g, '').toUpperCase();
      if (!/^[A-Z0-9]{6,20}$/.test(vat)) vat = '';
      var nameKey = R.norm(vendor);
      var existing = (V.tpl && byId(V.tpl.id)) || templates.find(function (t) { return (vat && t.vatId === vat) || t.nameKey === nameKey; }) || null;
      var fields = {};
      keys.forEach(function (f) {
        var r = V.regions[f];
        var anchor = V.noText[r.page] ? null : R.findAnchor(V.items[r.page] || [], r);
        fields[f] = { page: r.page, x: r.x, y: r.y, w: r.w, h: r.h, anchor: anchor || undefined, sample: (r.raw || '').slice(0, 200) };
      });
      var now = new Date().toISOString();
      var co = $('d-company').value;
      var t = R.cleanTemplate({
        id: existing ? existing.id : core.uid(),
        name: existing ? existing.name : vendor,
        vendor: vendor,
        vatId: vat || (existing ? existing.vatId : ''),
        nameKey: nameKey,
        fingerprint: V.noText[1] ? (existing ? existing.fingerprint : []) : R.fingerprint(V.items[1] || []),
        scanned: keys.every(function (f) { return V.noText[V.regions[f].page]; }),
        fields: fields,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        lastUsedAt: existing ? existing.lastUsedAt : null,
        uses: existing ? existing.uses : 0,
        lastInvoiceId: V.inv.id,
        fixedBilledTo: co && $('pv-fixco').checked ? co : '',
        fixedBilledPerson: !$('pv-fixperson-row').hidden && $('pv-fixperson').checked ? $('d-person').value.trim().toLowerCase() : ''
      });
      if (!t) { core.toast('The template could not be saved.'); return; }
      try { await putTemplate(t); } catch (e) { core.toast('Could not save the template: ' + e.message); return; }
      V.tpl = t;
      V.editing = false;
      V.inv.templateId = t.id;
      core.toast(existing ? 'Template “' + t.name + '” updated.' : 'Template saved for ' + t.name.replace(/\.$/, '') + '. New invoices from this vendor are read from these spots first.');
      if (V.select) setSelect(false, true);
      renderTplNote();
      updateSaveBar();
    }

    // ---------- template note in the fields panel ----------

    function isScanDoc() {
      var inv = V.inv;
      return !!(inv && (inv.scanned || inv.readError || (V.items[1] && V.noText[1])));
    }

    function renderTplNote() {
      var box = $('d-tpl');
      box.textContent = '';
      box.hidden = true;
      if (!V.inv) return;
      var t = V.tpl && byId(V.tpl.id);
      if (t) {
        var n = Object.keys(V.regions).filter(function (f) { return V.regions[f].src === 'template'; }).length;
        box.append(el('p', { text: 'Read with template “' + t.name + '”' + (n ? ' · ' + core.plural(n, 'field', 'fields') + ' from it' : '') + '.' }),
          el('button', { type: 'button', class: 'link', text: 'Edit template', onclick: function () { editTemplate(); } }));
        box.hidden = false;
        return;
      }
      if (!templates.length) return;
      var m = R.matchTemplate(templates, { text: V.inv.text || '', vatId: V.inv.vendorTaxId, vendor: V.inv.vendor, fingerprint: V.items[1] ? R.fingerprint(V.items[1]) : [] });
      if (!isScanDoc()) {
        if (!m) return;
        box.append(el('p', { text: 'Template “' + m.template.name + '” matches this invoice (by ' + (m.by === 'vat' ? 'VAT ID' : m.by === 'name' ? 'vendor name' : 'page header') + ').' }),
          el('button', { type: 'button', class: 'btn small', text: 'Apply template', onclick: function () { applyTemplateHere(m.template); } }));
        box.hidden = false;
        return;
      }
      var sorted = templates.slice().sort(function (a, b) { return (b.scanned ? 1 : 0) - (a.scanned ? 1 : 0) || a.name.localeCompare(b.name); });
      var sel = el('select', { id: 'd-tpl-pick', 'aria-label': 'Template to read this scan with' });
      sorted.forEach(function (t2) { sel.append(el('option', { value: t2.id, text: t2.name + (t2.scanned ? ' (scan)' : '') })); });
      if (m) sel.value = m.template.id;
      var status = el('span', { class: 'mono', role: 'status', style: 'font-size:12px' });
      box.append(el('p', { text: 'Read this scan with a vendor template. It uses OCR on each box, which takes a while.' }), sel,
        el('button', { type: 'button', class: 'btn small', text: 'Apply with OCR', onclick: function () { var tt = byId(sel.value); if (tt) applyTemplateHere(tt, status); } }), status);
      box.hidden = false;
    }

    async function applyTemplateHere(t, statusEl) {
      if (!V.pdf || V.busy) return;
      var keys = Object.keys(t.fields);
      for (var i = 0; i < keys.length; i++) if (t.fields[keys[i]].page <= V.pages) await ensureItems(t.fields[keys[i]].page);
      var needOcr = keys.filter(function (f) { return t.fields[f].page <= V.pages && V.noText[t.fields[f].page]; });
      if (needOcr.length && !window.confirm('Read ' + core.plural(needOcr.length, 'box', 'boxes') + ' with OCR? The first time this downloads the OCR engine and can take a minute.')) return;
      V.busy = true;
      var status = statusEl || el('span');
      try {
        var pages = await allPageItems();
        var res = readWithTemplate(t, pages);
        for (var k = 0; k < needOcr.length; k++) {
          var f = needOcr[k];
          var reg = t.fields[f];
          status.textContent = 'Reading ' + (k + 1) + ' of ' + needOcr.length + '…';
          var text = await ocrRect(V.pdf, reg, function (m) { status.textContent = progressText(m) + ' (' + (k + 1) + '/' + needOcr.length + ')'; });
          res.regions[f] = { page: reg.page, x: reg.x, y: reg.y, w: reg.w, h: reg.h, raw: text.slice(0, 400), src: 'template' };
          res.values[f] = P.parseField(f, text, parseOpts());
        }
        var filled = 0;
        keys.forEach(function (f) {
          if (!res.regions[f]) return;
          V.regions[f] = res.regions[f];
          var pr = applyField(f, res.regions[f], true);
          if (pr.ok) filled++;
        });
        if (t.fixedBilledTo && core.companyById(t.fixedBilledTo)) writeField('billedTo', t.fixedBilledTo);
        if (t.fixedBilledPerson) writeField('billedPerson', t.fixedBilledPerson);
        if (!res.values.vendor && t.vendor && !vendorName()) writeField('vendor', t.vendor);
        V.tpl = t;
        await noteTemplateUse(t, V.inv.id);
        drawRegions();
        renderTplNote();
        updateSaveBar();
        live('Template applied: ' + core.plural(filled, 'field', 'fields') + ' filled.');
        status.textContent = '';
      } catch (e) {
        console.warn(e);
        status.textContent = ocrMessage(e);
        core.toast(ocrMessage(e));
      } finally {
        V.busy = false;
      }
    }

    async function editTemplate() {
      var t = V.tpl && byId(V.tpl.id);
      if (!t || !V.pdf) return;
      var pages = await allPageItems();
      var located = readWithTemplate(t, pages).regions;
      Object.keys(t.fields).forEach(function (f) {
        if (!V.regions[f]) { V.regions[f] = located[f]; showSource(f, located[f]); }
      });
      V.editing = true;
      setSelect(true);
      var firstPage = Math.min.apply(null, Object.keys(V.regions).map(function (f) { return V.regions[f].page; }));
      if (firstPage && firstPage !== V.page) await renderPage(firstPage); else drawRegions();
      updateSaveBar();
      $('pv-select').focus();
    }

    // after OCR of a photo the word boxes are new: forget the old text layer and draw the page again
    function afterFullOcr(inv, itemsChanged) {
      if (itemsChanged && V.inv === inv && V.pdf) {
        V.items = {}; V.itemsP = {}; V.noText = {};
        renderPage(V.page);
      }
      renderTplNote();
    }

    // collectDetail hook: keep the boxes and where values came from
    function collect(inv) {
      if (V.inv !== inv) return;
      var regions = {};
      Object.keys(V.regions).forEach(function (f) {
        var r = V.regions[f];
        regions[f] = { page: r.page, x: r.x, y: r.y, w: r.w, h: r.h, raw: (r.raw || '').slice(0, 400), src: r.src || 'pdf' };
      });
      inv.regions = regions;
      var fromTpl = Object.keys(regions).filter(function (f) { return regions[f].src === 'template'; });
      inv.fromTemplate = fromTpl;
      if (V.tpl && byId(V.tpl.id)) inv.templateId = V.tpl.id;
      inv.confidence = Object.assign({}, inv.confidence);
      Object.keys(regions).forEach(function (f) { inv.confidence[f] = regions[f].src === 'template' ? 'template' : 'manual'; });
      if (V.tpl && V.tpl.fixedBilledTo && inv.billedTo === V.tpl.fixedBilledTo && !regions.billedTo) inv.confidence.billedTo = 'template';
      if (V.tpl && V.tpl.fixedBilledPerson && inv.billedPerson === V.tpl.fixedBilledPerson && !regions.billedPerson) inv.confidence.billedPerson = 'template';
    }

    // ---------- templates dialog ----------

    function saveBlob(blob, name) {
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function openTemplates() {
      renderTplList();
      var test = $('tp-test');
      test.hidden = true;
      test.textContent = '';
      $('templates').showModal();
    }

    function invoiceForTemplate(t) {
      var inv = t.lastInvoiceId && core.state.invoices.find(function (x) { return x.id === t.lastInvoiceId; });
      if (!inv) inv = core.state.invoices.filter(function (x) { return x.templateId === t.id; }).sort(function (a, b) { return (b.addedAt || '') < (a.addedAt || '') ? -1 : 1; })[0];
      return inv || null;
    }

    function renderTplList() {
      var ul = $('tp-list');
      ul.textContent = '';
      if (!templates.length) {
        ul.append(el('li', {}, [el('span', { class: 'muted', text: 'No templates yet. Open an invoice, choose Select fields on PDF, box the values and save them as a template.' })]));
        return;
      }
      templates.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'sl'); }).forEach(function (t) {
        var keys = Object.keys(t.fields);
        var meta = [t.vatId ? 'VAT ID ' + t.vatId : 'matched by name' + (t.fingerprint && t.fingerprint.length ? ' / header' : ''),
          'used ' + (t.uses || 0) + '×', t.lastUsedAt ? 'last used ' + core.dateStr(t.lastUsedAt.slice(0, 10)) : 'not used yet'];
        if (t.scanned) meta.push('scan · OCR');
        if (t.fixedBilledTo) meta.push('always ' + core.companyLabel(t.fixedBilledTo));
        if (t.fixedBilledPerson) meta.push('always ' + core.personLabel(t.fixedBilledPerson));
        var chips = el('div', { class: 'tpl-chips', 'aria-label': 'Fields covered' });
        R.FIELDS.forEach(function (fi) { if (t.fields[fi.key]) chips.append(el('span', { class: 'tpl-chip' }, [el('i', { 'aria-hidden': 'true', style: '--c:' + fi.color }), fi.label])); });
        var main = el('div', { class: 'tpl-main' }, [
          el('span', { class: 'tpl-name', text: t.name }),
          el('span', { class: 'tpl-meta', text: core.plural(keys.length, 'field', 'fields') + ' · ' + meta.join(' · ') }),
          chips
        ]);
        var editInv = invoiceForTemplate(t);
        var li = el('li', { 'data-id': t.id });
        var acts = el('div', { class: 'tpl-acts' }, [
          el('button', { type: 'button', class: 'btn small', text: 'Edit', disabled: editInv ? null : true, title: editInv ? null : 'No stored invoice uses this template', 'aria-label': 'Edit template ' + t.name, onclick: function () { editFromList(t.id); } }),
          el('button', { type: 'button', class: 'btn small', text: 'Test', 'aria-label': 'Test template ' + t.name + ' on an invoice', onclick: function () { openTest(t.id); } }),
          el('button', { type: 'button', class: 'btn small ghost', text: 'Rename', 'aria-label': 'Rename template ' + t.name, onclick: function () { startRename(li, main, t); } }),
          el('button', { type: 'button', class: 'btn small ghost danger', text: 'Delete', 'aria-label': 'Delete template ' + t.name, onclick: function () { deleteTemplate(t.id); } })
        ]);
        li.append(main, acts);
        ul.append(li);
      });
    }

    function startRename(li, main, t) {
      var input = el('input', { id: 'tp-rename-' + t.id, value: t.name, autocomplete: 'off', spellcheck: 'false', maxlength: '200' });
      var form = el('div', { class: 'tpl-rename tpl-main' }, [
        el('label', { class: 'sr', for: 'tp-rename-' + t.id, text: 'New name for ' + t.name }), input,
        el('button', { type: 'button', class: 'btn small primary', text: 'Save', onclick: done }),
        el('button', { type: 'button', class: 'btn small', text: 'Cancel', onclick: cancel })
      ]);
      main.replaceWith(form);
      input.focus();
      input.select();
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); done(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      });
      function cancel() { renderTplList(); focusRow(t.id, 'Rename'); }
      async function done() {
        var name = input.value.trim();
        if (!name) { input.focus(); return; }
        var cur = byId(t.id);
        if (cur) { cur.name = name.slice(0, 200); cur.updatedAt = new Date().toISOString(); await core.idb.put('templates', cur); }
        renderTplList();
        focusRow(t.id, 'Rename');
        core.toast('Template renamed.');
      }
    }

    function focusRow(id, label) {
      var li = $('tp-list').querySelector('li[data-id="' + id + '"]');
      var b = li && Array.from(li.querySelectorAll('button')).find(function (x) { return x.textContent === label; });
      if (b) b.focus();
    }

    async function deleteTemplate(id) {
      var t = byId(id);
      if (!t || !window.confirm('Delete the template “' + t.name + '”? Invoices already read with it keep their values.')) return;
      try { await core.idb.del('templates', id); } catch (e) { core.toast('Could not delete: ' + e.message); return; }
      templates = templates.filter(function (x) { return x.id !== id; });
      if (V.tpl && V.tpl.id === id) V.tpl = null;
      renderTplList();
      var test = $('tp-test');
      if (test.dataset.id === id) { test.hidden = true; test.textContent = ''; }
      $('tp-import-btn').focus();
      core.toast('Template deleted.');
    }

    function exportTemplates() {
      if (!templates.length) { core.toast('No templates to export yet.'); return; }
      var data = { app: 'adrial-invoices-templates', version: 1, exportedAt: new Date().toISOString(), templates: allTemplates() };
      var d = new Date();
      var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'invoice-templates-' + stamp + '.json');
    }

    async function importFile(file) {
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error('the file is too big');
        var data = JSON.parse(await file.text());
        var list = Array.isArray(data) ? data : (data && Array.isArray(data.templates) ? data.templates : null);
        if (!list) throw new Error('this is not a templates file');
        var n = await importTemplates(list, { keepExisting: false });
        renderTplList();
        core.toast(n ? 'Imported ' + core.plural(n, 'template', 'templates') + '.' : 'No usable templates in that file.');
      } catch (e) {
        core.toast('Could not import: ' + e.message + '.');
      }
    }

    function editFromList(id) {
      var t = byId(id);
      var inv = t && invoiceForTemplate(t);
      if (!inv) { core.toast('Open an invoice from this vendor first, then choose Edit template there.'); return; }
      $('templates').close();
      core.openDetail(inv.id, []);
      V.pendingEdit = id;
    }

    // ---------- test a template on a stored invoice ----------

    function openTest(id) {
      var t = byId(id);
      if (!t) return;
      var box = $('tp-test');
      box.dataset.id = id;
      box.textContent = '';
      var sel = el('select', { id: 'tp-inv' });
      var invs = core.state.invoices.slice().sort(function (a, b) {
        var ma = a.templateId === id || (t.vatId && a.vendorTaxId === t.vatId) || R.norm(a.vendor) === t.nameKey ? 1 : 0;
        var mb = b.templateId === id || (t.vatId && b.vendorTaxId === t.vatId) || R.norm(b.vendor) === t.nameKey ? 1 : 0;
        return mb - ma || ((b.issueDate || '') < (a.issueDate || '') ? -1 : 1);
      });
      invs.forEach(function (inv) {
        sel.append(el('option', { value: inv.id, text: [inv.vendor || inv.fileName, inv.number, inv.issueDate ? core.dateStr(inv.issueDate) : ''].filter(Boolean).join(' · ') + (inv.scanned ? ' · scan' : '') }));
      });
      var out = el('div', { id: 'tp-out', 'aria-live': 'polite' });
      var run = el('button', { type: 'button', class: 'btn small primary', text: 'Run test', disabled: invs.length ? null : true, onclick: function () { runTest(id, sel.value, out, false); } });
      box.append(
        el('h3', { id: 'tp-test-h', text: 'Test “' + t.name + '” on an invoice' }),
        el('p', { class: 'help', text: 'Nothing is saved. This only shows what the template would read, next to what the invoice holds now.' }),
        el('div', { class: 'tp-run' }, [el('div', { class: 'f' }, [el('label', { for: 'tp-inv', text: 'Invoice' }), sel]), run]),
        out
      );
      box.hidden = false;
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      sel.focus();
    }

    async function runTest(id, invId, out, useOcr) {
      var t = byId(id);
      var inv = core.state.invoices.find(function (x) { return x.id === invId; });
      if (!t || !inv) return;
      out.textContent = '';
      var status = el('p', { class: 'help', role: 'status', text: 'Reading the invoice…' });
      out.append(status);
      var pdf = null;
      try {
        pdf = await core.openDoc(inv, function (m) { status.textContent = m; });
        var pages = [];
        var noText = {};
        for (var p = 1; p <= Math.min(pdf.numPages, 15); p++) {
          var page = await pdf.getPage(p);
          var items = pdf.pageItems ? (pdf.pageItems[p - 1] || []) : R.itemsFromTextContent((await page.getTextContent()).items, page.getViewport({ scale: 1 }));
          pages.push(items);
          noText[p] = !R.hasTextLayer(items);
        }
        var res = readWithTemplate(t, pages);
        var keys = Object.keys(t.fields);
        var ocrKeys = keys.filter(function (f) { return noText[t.fields[f].page]; });
        if (ocrKeys.length && useOcr) {
          for (var k = 0; k < ocrKeys.length; k++) {
            var f0 = ocrKeys[k];
            var reg = t.fields[f0];
            status.textContent = 'OCR ' + (k + 1) + ' of ' + ocrKeys.length + '…';
            var txt = await ocrRect(pdf, reg, function (m) { status.textContent = progressText(m) + ' (' + (k + 1) + '/' + ocrKeys.length + ')'; });
            res.regions[f0] = { page: reg.page, x: reg.x, y: reg.y, w: reg.w, h: reg.h, raw: txt, src: 'template' };
            res.values[f0] = P.parseField(f0, txt, parseOpts());
          }
        }
        status.remove();
        // left: the page(s) with the boxes; right: field by field
        var left = el('div', { style: 'display:flex;flex-direction:column;gap:10px' });
        var usedPages = Array.from(new Set(keys.map(function (f) { return res.regions[f].page; }))).sort().slice(0, 3);
        for (var u = 0; u < usedPages.length; u++) {
          var pn = usedPages[u];
          if (pn > pdf.numPages) continue;
          var pg = await pdf.getPage(pn);
          var base = pg.getViewport({ scale: 1 });
          var vp = pg.getViewport({ scale: Math.min(2, 760 / base.width) });
          var c = el('canvas', { role: 'img', 'aria-label': 'Page ' + pn + ' with the template boxes' });
          c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          var holder = el('div', { class: 'tp-page' }, [c]);
          keys.forEach(function (f) { if (res.regions[f].page === pn) holder.append(regionEl(f, Object.assign({}, res.regions[f], { src: '' }), false)); });
          left.append(holder);
        }
        var tbody = el('tbody');
        var same = 0;
        keys.forEach(function (f) {
          var pr = res.values[f];
          var now = f === 'billedTo' ? inv.billedTo : inv[f];
          var raw = res.regions[f].raw;
          var verdict;
          if (noText[t.fields[f].page] && !useOcr) verdict = el('span', { class: 'muted', text: 'needs OCR' });
          else if (!pr.ok) verdict = el('span', { class: 'diff', text: 'not read' });
          else {
            var eq = AMOUNT[f] ? now != null && Math.abs(now - pr.value) < 0.005 : String(now || '').replace(/\s/g, '').toUpperCase() === String(pr.value).replace(/\s/g, '').toUpperCase();
            if (eq) same++;
            verdict = el('span', { class: eq ? 'same' : 'diff', text: eq ? 'same' : 'differs' });
          }
          tbody.append(el('tr', {}, [
            el('th', { scope: 'row', text: fieldLabel(f) }),
            el('td', { text: display(f, now) }),
            el('td', {}, [pr.ok ? display(f, pr.value) : '–', el('span', { class: 'raw', title: raw || '', text: raw ? '“' + oneLine(raw, 60) + '”' : '(empty)' })]),
            el('td', {}, [verdict])
          ]));
        });
        var table = el('table', { class: 'tp-table' }, [
          el('caption', { class: 'sr', text: 'What the template reads compared with the saved invoice' }),
          el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Field' }), el('th', { scope: 'col', text: 'On the invoice now' }), el('th', { scope: 'col', text: 'Template reads' }), el('th', { scope: 'col', text: '' })])]),
          tbody
        ]);
        var right = el('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:0' }, [
          el('p', { class: 'help', text: same + ' of ' + keys.length + ' fields match what is saved. Nothing was changed.' }),
          el('div', { class: 'table-scroll' }, [table])
        ]);
        if (ocrKeys.length && !useOcr) {
          right.append(el('button', { type: 'button', class: 'btn small', text: 'Read ' + core.plural(ocrKeys.length, 'scanned box', 'scanned boxes') + ' with OCR', onclick: function () { runTest(id, invId, out, true); } }));
        }
        out.append(el('div', { class: 'tp-cmp' }, [left, right]));
      } catch (e) {
        console.warn(e);
        status.textContent = useOcr ? ocrMessage(e) : 'The test could not run: ' + e.message + '.';
      } finally {
        if (pdf) { try { pdf.destroy(); } catch (e2) { /* ignore */ } }
      }
    }

    // ---------- events ----------

    function bind() {
      $('pv-prev').addEventListener('click', function () { renderPage(V.page - 1); });
      $('pv-next').addEventListener('click', function () { renderPage(V.page + 1); });
      $('pv-zin').addEventListener('click', function () { zoomStep(1); });
      $('pv-zout').addEventListener('click', function () { zoomStep(-1); });
      $('pv-zfit').addEventListener('click', function () { setZoom('fit'); });
      $('pv-select').addEventListener('click', function () { if (!V.select) V.editing = false; setSelect(!V.select); });
      $('pv-list-btn').addEventListener('click', function () {
        var list = $('pv-list');
        list.hidden = !list.hidden;
        this.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
        if (!list.hidden) { refreshItemList(); $('pv-items').focus(); } else hideHover();
      });
      var fsel = $('pv-field');
      R.FIELDS.forEach(function (fi) { fsel.append(el('option', { value: fi.key, text: fi.label })); });
      $('pv-items').addEventListener('change', function () {
        var items = V.items[V.page] || [];
        var picked = Array.from(this.selectedOptions).map(function (o) { return items[+o.value]; }).filter(Boolean);
        showHover(picked.length ? R.unionRect(picked) : null);
        var g = guessField(picked.map(function (x) { return x.s; }).join(' '));
        if (g) fsel.value = g;
      });
      $('pv-assign').addEventListener('click', assignFromList);
      $('pv-save-btn').addEventListener('click', saveTemplate);
      $('pv-fixco').addEventListener('change', function () { $('pv-save').dataset.touched = '1'; });
      $('pv-fixperson').addEventListener('change', function () { $('pv-save').dataset.touchedPerson = '1'; });
      $('d-person').addEventListener('change', function () { updateSaveBar(); });
      $('d-vendor').addEventListener('input', updateSaveBar);
      $('d-company').addEventListener('change', function () { updateSaveBar(); });
      $('pv-pop-close').addEventListener('click', function () { closePop(); });
      $('pv-pop-cancel').addEventListener('click', function () { closePop(); });
      $('pv-pop-remove').addEventListener('click', function () { var f = V.popFor; closePop(true); removeRegion(f, true); });
      $('pv-pop-ocr-btn').addEventListener('click', ocrPending);

      var dlg = $('detail');
      // Esc closes the popover first, then leaves select mode, and only then the dialog
      dlg.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (!$('pv-pop').hidden) { e.preventDefault(); e.stopPropagation(); closePop(); return; }
        if (V.select) { e.preventDefault(); e.stopPropagation(); setSelect(false); $('pv-select').focus(); }
      }, true);
      dlg.addEventListener('cancel', function (e) {
        if (!$('pv-pop').hidden) { e.preventDefault(); closePop(); }
        else if (V.select) { e.preventDefault(); setSelect(false); }
      });
      dlg.addEventListener('pointerdown', function (e) {
        var pop = $('pv-pop');
        if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.pv-ov')) closePop(true);
      }, true);
      var rt = null;
      window.addEventListener('resize', function () {
        clearTimeout(rt);
        rt = setTimeout(function () { if (V.pdf && $('detail').open && V.zoom === 'fit') renderPage(V.page); }, 200);
      });

      $('tp-close').addEventListener('click', function () { $('templates').close(); });
      $('tp-export-btn').addEventListener('click', exportTemplates);
      $('tp-import-btn').addEventListener('click', function () { $('tp-import').click(); });
      $('tp-import').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (f) importFile(f); });
    }

    bind();

    return {
      setTemplates: setTemplates,
      allTemplates: allTemplates,
      importTemplates: importTemplates,
      noteTemplateUse: noteTemplateUse,
      applyOnImport: applyOnImport,
      onOpen: onOpen,
      onClose: onClose,
      showDoc: showDoc,
      previewFailed: previewFailed,
      collect: collect,
      afterFullOcr: afterFullOcr,
      openTemplates: openTemplates,
      personName: personName,
      // for the end-to-end test
      _view: function () { return V; }
    };
  }

  window.InvoiceFieldMap = { init: init };
})();
