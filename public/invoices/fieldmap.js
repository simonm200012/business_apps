/* InvoiceFieldMap: document viewer (PDF or photo), "select fields on the document", vendor templates, region OCR. */
(function (root) {
  'use strict';
  var R = root.InvoiceRegions, P = root.InvoiceParser, M = root.InvoiceMedia;
  var VIEW_KEY = 'adrial-invoices-viewer';

  function init(core) {
    var $ = core.$, esc = core.esc, cur = null, pickBtns = false;
    function zoomGet() { try { return (JSON.parse(localStorage.getItem(VIEW_KEY)) || {}).zoom || 1; } catch (e) { return 1; } }
    function zoomSet(z) { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ zoom: z })); } catch (e) {} }
    function fieldDef(key) { return R.FIELDS.filter(function (f) { return f.key === key; })[0]; }

    /* ---------- import: apply a matching template ---------- */
    function applyOnImport(parsed, items) {
      var m = R.matchTemplate(core.state.templates, { vatId: parsed.vendorTaxId, vendor: parsed.vendor, items: items });
      if (!m) return parsed;
      var t = m.template, vals = R.readTemplate(t, items), conf = parsed.confidence = parsed.confidence || {};
      Object.keys(vals).forEach(function (k) { parsed[k] = vals[k]; conf[k] = 'template'; });
      if (vals.total != null && vals.vat != null && vals.net == null) { parsed.net = core.r2(vals.total - vals.vat); conf.net = 'template'; }
      if (parsed.net && parsed.vat != null) parsed.vatRate = P.snapRate(parsed.vat / parsed.net * 100);
      if (parsed.currency === 'EUR') parsed.eur = parsed.total;
      if (t.fixedBilledTo) { parsed.billedTo = t.fixedBilledTo; conf.billedTo = 'template'; }
      if (t.fixedBilledPerson) { parsed.billedPerson = t.fixedBilledPerson; conf.billedPerson = 'template'; }
      parsed.templateId = t.id; parsed.regions = JSON.parse(JSON.stringify(t.fields)); t.uses = (t.uses | 0) + 1; core.saveTemplate(t);
      return parsed;
    }

    /* ---------- viewer ---------- */
    function ensurePickButtons() {
      if (pickBtns) return; pickBtns = true;
      R.FIELDS.forEach(function (f) {
        var inp = $(f.input), lab = inp && inp.parentElement && inp.parentElement.querySelector('span'); if (!lab) return;
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pick'; b.dataset.field = f.key; b.textContent = '◎'; b.title = 'Select the ' + f.label.toLowerCase() + ' on the document'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Select ' + f.label + ' on the document');
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); setPicking(cur && cur.picking === f.key ? null : f.key); };
        lab.appendChild(b);
      });
      $('d-tpl-save').onclick = saveTemplate; $('d-tpl-clear').onclick = clearTemplate;
    }
    function setPicking(key) {
      if (!cur) return; cur.picking = key;
      Array.prototype.forEach.call(document.querySelectorAll('#detail .pick'), function (b) { var on = b.dataset.field === key; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      Array.prototype.forEach.call(document.querySelectorAll('#viewer .v-page'), function (p) { p.classList.toggle('pick-mode', !!key); });
      var hint = $('viewer').querySelector('.v-hint'); if (hint) hint.textContent = key ? 'Drag a rectangle (or click a word) for: ' + fieldDef(key).label + '. Esc cancels.' : 'Tip: use the ◎ buttons next to the fields to select them on the document.';
    }
    async function onOpen(inv) {
      onClose(); ensurePickButtons();
      var token = {}, v = $('viewer'); cur = { token: token, inv: inv, doc: null, items: inv.ocrItems && inv.ocrItems.length ? inv.ocrItems.slice() : [], pages: [], regions: JSON.parse(JSON.stringify(inv.regions || {})), picking: null, zoom: zoomGet(), pdfItems: false };
      v.innerHTML = '<div class="v-bar"><button type="button" data-z="-">−</button><button type="button" data-z="+">+</button><button type="button" data-z="0">Fit</button><span class="small muted" data-pg></span></div><div class="v-hint"></div><div class="v-pages"><span class="muted">Loading…</span></div>';
      v.querySelector('.v-bar').onclick = function (e) { var z = e.target.dataset && e.target.dataset.z; if (!z) return; cur.zoom = z === '0' ? 1 : Math.max(0.4, Math.min(3, cur.zoom * (z === '+' ? 1.25 : 0.8))); zoomSet(cur.zoom); renderPages(); };
      info();
      try {
        var blob = await core.fileBlob(inv.id); if (cur.token !== token) return;
        if (!blob) { v.querySelector('.v-pages').innerHTML = '<span class="muted">The file is not on this device.</span>'; return; }
        if (/^image\//.test(inv.mime)) cur.doc = await M.asDocument(blob);
        else { if (!root.pdfjsLib) throw new Error('pdf.js did not load (offline?).'); cur.doc = await root.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise; }
        if (cur.token !== token) { try { cur.doc.destroy(); } catch (e) {} return; }
        await renderPages(); setPicking(null);
      } catch (e) { if (cur && cur.token === token) v.querySelector('.v-pages').innerHTML = '<span class="muted">Could not show the document: ' + esc(e.message || e) + '</span>'; }
    }
    async function renderPages() {
      var c = cur; if (!c || !c.doc) return; var token = c.token, host = $('viewer').querySelector('.v-pages'), doc = c.doc, n = Math.min(doc.numPages, 15), pdfItems = [], dpr = Math.min(2, root.devicePixelRatio || 1);
      host.innerHTML = ''; c.pages = [];
      for (var p = 1; p <= n; p++) {
        var page = await doc.getPage(p); if (cur !== c) return;
        var vp1 = page.getViewport({ scale: 1 }), fit = Math.max(200, ($('viewer').clientWidth || 600) - 28) / vp1.width, scale = fit * c.zoom, vp = page.getViewport({ scale: scale });
        var wrap = document.createElement('div'); wrap.className = 'v-page'; wrap.dataset.p = p - 1; wrap.style.width = vp.width + 'px'; wrap.style.height = vp.height + 'px';
        var cv = document.createElement('canvas'); cv.width = Math.round(vp.width * dpr); cv.height = Math.round(vp.height * dpr); cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px'; wrap.appendChild(cv); host.appendChild(wrap);
        c.pages.push({ el: wrap, w: vp.width, h: vp.height });
        await page.render({ canvasContext: cv.getContext('2d'), viewport: page.getViewport({ scale: scale * dpr }) }).promise;
        if (cur !== c) return;
        if (!doc.isPhoto && !c.pdfItems) { var tc = await page.getTextContent(); tc.items.forEach(function (it) { if (it.str && it.str.trim()) pdfItems.push(R.fromPdfItem(it, vp1.transform, vp1.width, vp1.height, p - 1)); }); }
        bindPage(wrap, p - 1);
      }
      if (!doc.isPhoto && !c.pdfItems) { c.pdfItems = true; if (pdfItems.length) c.items = pdfItems; }
      var pg = $('viewer').querySelector('[data-pg]'); if (pg) pg.textContent = doc.numPages + (doc.numPages === 1 ? ' page' : ' pages') + (doc.numPages > n ? ' (first ' + n + ' shown)' : '');
      drawRegions(); setPicking(c.picking);
    }
    function drawRegions() {
      if (!cur) return;
      cur.pages.forEach(function (pg) { Array.prototype.forEach.call(pg.el.querySelectorAll('.v-rect.saved'), function (e) { e.remove(); }); });
      Object.keys(cur.regions).forEach(function (k) {
        var r = cur.regions[k], pg = cur.pages[r.p || 0]; if (!pg) return; var loc = R.locate(r, cur.items);
        var d = document.createElement('div'); d.className = 'v-rect saved'; d.style.cssText = 'left:' + loc.x * pg.w + 'px;top:' + loc.y * pg.h + 'px;width:' + loc.w * pg.w + 'px;height:' + loc.h * pg.h + 'px';
        d.innerHTML = '<span>' + esc((fieldDef(k) || { label: k }).label) + '</span>'; pg.el.appendChild(d);
      });
    }
    function bindPage(el, pIdx) {
      var start = null, tmp = null;
      function pt(e) { var b = el.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; }
      el.addEventListener('pointerdown', function (e) {
        if (!cur || !cur.picking) return; e.preventDefault(); start = pt(e); el.setPointerCapture(e.pointerId);
        tmp = document.createElement('div'); tmp.className = 'v-rect'; el.appendChild(tmp);
      });
      el.addEventListener('pointermove', function (e) {
        if (!start) return; var q = pt(e), r = R.rectFrom(pIdx, start.x, start.y, q.x, q.y);
        tmp.style.cssText = 'left:' + r.x * 100 + '%;top:' + r.y * 100 + '%;width:' + r.w * 100 + '%;height:' + r.h * 100 + '%';
      });
      el.addEventListener('pointerup', function (e) {
        if (!start) return; var q = pt(e), b = el.getBoundingClientRect(), r = R.rectFrom(pIdx, start.x, start.y, q.x, q.y); start = null; if (tmp) { tmp.remove(); tmp = null; }
        if (r.w * b.width < 6 && r.h * b.height < 6) { // a click: take the word under the pointer
          var hit = cur.items.filter(function (it) { return (it.p || 0) === pIdx && q.x >= it.x && q.x <= it.x + it.w && q.y >= it.y && q.y <= it.y + it.h; })[0];
          if (!hit) { core.toast('Drag a rectangle around the text.'); return; }
          r = { p: pIdx, x: hit.x, y: hit.y, w: hit.w, h: hit.h };
        }
        handlePick(cur.picking, r);
      });
      el.addEventListener('pointercancel', function () { start = null; if (tmp) { tmp.remove(); tmp = null; } });
    }
    async function pageCanvas(pIdx) {
      if (cur.doc.isPhoto) return cur.doc.canvas;
      var page = await cur.doc.getPage(pIdx + 1), vp = page.getViewport({ scale: 2.5 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; return cv;
    }
    async function handlePick(key, rect) {
      var c = cur, def = fieldDef(key), text = R.textInRect(c.items, rect);
      if (!text) {
        core.toast('No text layer there: reading the area with OCR…', 2500);
        try { text = await M.ocrRegion(await pageCanvas(rect.p), rect, { langs: 'slv+eng' }); } catch (e) { core.toast('OCR failed: ' + (e.message || e), 5000); return; }
      }
      if (cur !== c) return;
      var val = R.cast(def.type, text);
      if (val === '' || val == null || (def.type === 'amount' && typeof val !== 'number')) { core.toast('Could not read ' + (def.type === 'text' ? 'text' : 'a ' + def.type) + ' from "' + text.slice(0, 40) + '".'); return; }
      core.setField(key, val, 'template');
      var a = R.findAnchor(c.items, rect); c.regions[key] = { p: rect.p, x: rect.x, y: rect.y, w: rect.w, h: rect.h, anchor: a };
      setPicking(null); drawRegions(); info(); core.toast(def.label + ': ' + val);
    }
    function info() {
      if (!cur) return; var inv = cur.inv, n = Object.keys(cur.regions).length, t = core.state.templates.filter(function (x) { return x.id === inv.templateId; })[0];
      $('d-tpl-info').textContent = t ? 'Template "' + t.name + '" (used ' + (t.uses | 0) + 'x), ' + n + ' fields' : (n ? n + ' fields selected, not saved as a template yet' : '');
      $('d-tpl-clear').hidden = !t;
    }
    async function saveTemplate() {
      if (!cur) return; var inv = cur.inv, o = core.collectDetail();
      if (!Object.keys(cur.regions).length) return core.toast('First select at least one field with the ◎ buttons.');
      if (!o.vendor) return core.toast('Enter the vendor first.');
      var old = core.state.templates.filter(function (x) { return x.id === inv.templateId; })[0] || core.state.templates.filter(function (x) { return (o.vendorTaxId && x.vatId === o.vendorTaxId) || (x.nameKey && x.nameKey === P.normName(o.vendor)); })[0];
      var t = R.cleanTemplate({ id: old && old.id, name: o.vendor, vatId: o.vendorTaxId, nameKey: P.normName(o.vendor), fingerprint: R.fingerprint(cur.items), fields: cur.regions, fixedBilledTo: old ? old.fixedBilledTo : '', fixedBilledPerson: old ? old.fixedBilledPerson : '', uses: old ? old.uses : 0, createdAt: old && old.createdAt });
      await core.saveTemplate(t); inv.templateId = t.id; inv.regions = JSON.parse(JSON.stringify(t.fields)); inv.fromTemplate = true; await core.saveInvoice(inv);
      info(); core.toast('Template saved for ' + o.vendor);
    }
    async function clearTemplate() {
      if (!cur) return; var inv = cur.inv; if (!inv.templateId) return;
      if (!(await core.ask('<p>Forget the saved field positions for this vendor?</p>', { title: 'Delete template', ok: 'Forget' }))) return;
      await core.deleteTemplate(inv.templateId); inv.templateId = ''; inv.regions = null; inv.fromTemplate = false; cur.regions = {}; await core.saveInvoice(inv); drawRegions(); info();
    }
    function onItems(inv) { if (cur && cur.inv === inv && inv.ocrItems) { cur.items = inv.ocrItems.slice(); drawRegions(); } }
    function onClose() { if (!cur) return; try { cur.doc && cur.doc.destroy && cur.doc.destroy(); } catch (e) {} cur = null; var v = $('viewer'); if (v) v.innerHTML = ''; }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cur && cur.picking) { e.preventDefault(); e.stopPropagation(); setPicking(null); } }, true);

    /* ---------- templates dialog ---------- */
    function openTemplates() { renderTemplates(); $('templates').showModal(); }
    function renderTemplates() {
      var l = core.state.templates;
      $('t-list').innerHTML = l.length ? '<table class="cmp"><thead><tr><th>Vendor</th><th>VAT ID</th><th>Fields</th><th>Used</th><th></th></tr></thead><tbody>' + l.map(function (t) {
        return '<tr><td>' + esc(t.name) + '</td><td class="mono small">' + esc(t.vatId) + '</td><td>' + Object.keys(t.fields).map(function (k) { return esc((fieldDef(k) || { label: k }).label); }).join(', ') + '</td><td>' + (t.uses | 0) + '</td>' +
          '<td class="nowrap"><button class="link" data-t="test" data-id="' + t.id + '">Test</button><button class="link" data-t="rename" data-id="' + t.id + '">Rename</button><button class="link danger" data-t="del" data-id="' + t.id + '">Delete</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted">No templates yet.</p>';
    }
    async function testTemplate(t) {
      var inv = core.state.invoices.filter(function (i) { return i.templateId === t.id || (t.vatId && i.vendorTaxId === t.vatId); })[0];
      if (!inv) return core.toast('No invoice from this vendor to test with.');
      var items = inv.ocrItems; if (!items || !items.length) { var b = await core.fileBlob(inv.id); if (!b) return core.toast('The file is not on this device.'); items = (await core.extractPdf(await b.arrayBuffer())).items; }
      var v = R.readTemplate(t, items), keys = Object.keys(t.fields);
      await core.ask('<p>Reading <b>' + esc(inv.fileName) + '</b> with the template:</p><table class="cmp"><tbody>' + keys.map(function (k) { return '<tr><td>' + esc((fieldDef(k) || { label: k }).label) + '</td><td>' + (v[k] != null ? esc(v[k]) : '<span class="muted">nothing found</span>') + '</td></tr>'; }).join('') + '</tbody></table>', { title: 'Template test', ok: 'Close', single: true });
    }
    function bindDialog() {
      $('t-list').addEventListener('click', async function (e) {
        var b = e.target.closest('button[data-t]'); if (!b) return; var t = core.state.templates.filter(function (x) { return x.id === b.dataset.id; })[0]; if (!t) return;
        if (b.dataset.t === 'del') { if (await core.ask('<p>Delete the template for <b>' + esc(t.name) + '</b>?</p>', { title: 'Delete template', ok: 'Delete' })) { await core.deleteTemplate(t.id); renderTemplates(); } }
        else if (b.dataset.t === 'rename') { if (await core.ask('<label class="fld">Name<input id="ask-name" value="' + esc(t.name) + '"></label>', { title: 'Rename template', ok: 'Rename' })) { var nm = $('ask-name').value.trim(); if (nm) { t.name = nm; await core.saveTemplate(t); renderTemplates(); } } }
        else testTemplate(t).catch(function (x) { core.toast('Test failed: ' + x.message); });
      });
      $('t-export').onclick = function () { core.saveBlob(new Blob([JSON.stringify({ app: 'adrial-invoices-templates', version: 1, templates: core.state.templates }, null, 1)], { type: 'application/json' }), 'invoice-templates.json'); };
      $('t-import').onclick = function () { $('t-import-file').click(); };
      $('t-import-file').onchange = async function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        try {
          var d = JSON.parse(await f.text()); if (d.app !== 'adrial-invoices-templates' || !Array.isArray(d.templates)) throw new Error('This is not a templates file.');
          for (var i = 0; i < d.templates.length; i++) await core.saveTemplate(R.cleanTemplate(d.templates[i]));
          renderTemplates(); core.toast('Imported ' + d.templates.length + ' templates');
        } catch (x) { core.toast(x.message, 5000); }
      };
    }
    bindDialog();
    return { applyOnImport: applyOnImport, onOpen: onOpen, onClose: onClose, onItems: onItems, openTemplates: openTemplates };
  }
  root.InvoiceFieldMap = { init: init };
})(window);
