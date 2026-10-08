/* Photos of invoices — Adrial Apps · Invoices.
 *
 * InvoiceMedia.isImage(fileOrType)            JPG / PNG / WebP / HEIC / … (HEIC only where the browser decodes it)
 * InvoiceMedia.decode(blob) → ImageBitmap-like  (throws when this browser cannot read the format)
 * InvoiceMedia.ocr(blob, { loadScript, url, onProgress, maxSide }) → { lines, items, width, height, langs }
 *   Whole-photo OCR with tesseract.js (loaded only when called). items are page-relative word boxes in the
 *   same shape regions.js uses ({ s, x, y, w, h }), so field selection and vendor templates work on photos.
 * InvoiceMedia.doc(blob, items) → a pdf.js-like document (numPages 1, getPage → getViewport / render /
 *   getTextContent) so the viewer, region OCR and template tests treat a photo like a one-page PDF.
 */
(function (root) {
  'use strict';

  var IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?)$/i;
  function isImage(f) {
    if (!f) return false;
    var type = typeof f === 'string' ? f : f.type || '';
    if (/^image\//i.test(type)) return true;
    return typeof f !== 'string' && IMAGE_EXT.test(f.name || '');
  }
  function mimeOf(file) {
    if (file.type) return file.type;
    var m = (file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    var ext = m ? m[1] : '';
    return { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' }[ext] || 'application/octet-stream';
  }
  function extOf(mime, name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
    return { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tif' }[mime] || 'bin';
  }

  async function decode(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall back to <img> */ }
    }
    var url = URL.createObjectURL(blob);
    try {
      var img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } catch (e) {
      throw new Error('this browser cannot open this image format');
    } finally {
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
  }
  function dims(img) { return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }; }

  // a canvas no bigger than maxSide on its longest side (huge phone photos make OCR slow)
  function toCanvas(img, maxSide) {
    var d = dims(img);
    var s = Math.min(1, (maxSide || 2400) / Math.max(d.w, d.h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(d.w * s));
    c.height = Math.max(1, Math.round(d.h * s));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  var worker = null;
  var workerP = null;
  var progressCb = null;
  var langs = '';
  function getWorker(loadScript, url) {
    if (worker) return Promise.resolve(worker);
    if (workerP) return workerP;
    workerP = (async function () {
      await loadScript(url);
      if (!window.Tesseract || !window.Tesseract.createWorker) throw new Error('the OCR library did not start');
      var logger = function (m) { if (progressCb) progressCb(m); };
      try {
        worker = await window.Tesseract.createWorker('eng+slv+hrv', 1, { logger: logger });
        langs = 'eng+slv+hrv';
      } catch (e) {
        worker = await window.Tesseract.createWorker('eng', 1, { logger: logger });
        langs = 'eng';
      }
      return worker;
    })();
    workerP.catch(function () { workerP = null; });
    return workerP;
  }
  function release() {
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
    worker = null; workerP = null;
  }

  function wordsOf(data) {
    if (data.words && data.words.length) return data.words;
    var out = [];
    (data.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (w) { out.push(w); }); });
      });
    });
    return out;
  }

  async function ocr(blob, opts) {
    opts = opts || {};
    var img = await decode(blob);
    var canvas = toCanvas(img, opts.maxSide || 2400);
    if (img.close) img.close();
    progressCb = opts.onProgress || null;
    var w = await getWorker(opts.loadScript, opts.url);
    var res = await w.recognize(canvas);
    progressCb = null;
    var W = canvas.width;
    var H = canvas.height;
    var items = [];
    wordsOf(res.data || {}).forEach(function (wd) {
      var t = String(wd.text || '').trim();
      var b = wd.bbox;
      if (!t || !b || (wd.confidence != null && wd.confidence < 20)) return;
      items.push({ s: t, x: b.x0 / W, y: b.y0 / H, w: Math.max(1, b.x1 - b.x0) / W, h: Math.max(1, b.y1 - b.y0) / H });
    });
    var R = root.InvoiceRegions;
    var lines = R ? R.textInRect(items, { x: 0, y: 0, w: 1, h: 1 }).split('\n') : String(res.data.text || '').split('\n');
    items = items.map(function (it) { return { s: it.s, x: +it.x.toFixed(4), y: +it.y.toFixed(4), w: +it.w.toFixed(4), h: +it.h.toFixed(4) }; });
    return { lines: lines.filter(function (l) { return l.trim(); }), items: [items], width: W, height: H, langs: langs };
  }

  // pdf.js-like viewport for an image of W×H "points" (1 point = 1 pixel at scale 1)
  function viewport(W, H, scale, ox, oy) {
    var s = scale || 1;
    ox = ox || 0; oy = oy || 0;
    return {
      width: W * s, height: H * s, scale: s, offsetX: ox, offsetY: oy,
      convertToViewportRectangle: function (r) { return [r[0] * s + ox, (H - r[1]) * s + oy, r[2] * s + ox, (H - r[3]) * s + oy]; }
    };
  }

  async function doc(blob, items) {
    var img = await decode(blob);
    var d = dims(img);
    var page = {
      getViewport: function (o) { return viewport(d.w, d.h, o && o.scale, o && o.offsetX, o && o.offsetY); },
      render: function (o) {
        var vp = o.viewport;
        var cancelled = false;
        var p = new Promise(function (resolve, reject) {
          setTimeout(function () {
            if (cancelled) { reject(new Error('cancelled')); return; }
            var ctx = o.canvasContext;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, vp.offsetX, vp.offsetY, d.w * vp.scale, d.h * vp.scale);
            resolve();
          }, 0);
        });
        return { promise: p, cancel: function () { cancelled = true; } };
      },
      getTextContent: function () { return Promise.resolve({ items: [] }); }
    };
    return {
      kind: 'image', numPages: 1, width: d.w, height: d.h,
      // OCR word boxes stored with the invoice (page-relative); the viewer uses them directly
      pageItems: items || null,
      getPage: function () { return Promise.resolve(page); },
      destroy: function () { if (img.close) img.close(); }
    };
  }

  var api = { isImage: isImage, mimeOf: mimeOf, extOf: extOf, decode: decode, toCanvas: toCanvas, ocr: ocr, doc: doc, release: release };
  root.InvoiceMedia = api;
})(window);
