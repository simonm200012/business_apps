/* InvoiceMedia: photo decoding, OCR with tesseract.js (loaded lazily), a photo wrapped as a pdf.js-like document. */
(function (root) {
  'use strict';
  var TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var loading = {};
  function loadScript(url) {
    if (loading[url]) return loading[url];
    loading[url] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = url; s.async = true; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
      s.onload = function () { res(); }; s.onerror = function () { delete loading[url]; rej(new Error('Could not load ' + url + ' (offline?).')); };
      document.head.appendChild(s);
    });
    return loading[url];
  }
  function isImage(f) { return /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name || ''); }
  /* File/Blob -> canvas (long side <= maxDim) */
  async function decode(file, maxDim) {
    maxDim = maxDim || 2600; var src, w, h;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; }
    catch (e) {
      src = await new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () { URL.revokeObjectURL(url); res(im); }; im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('This browser cannot read ' + (file.name || 'this image') + ' (HEIC needs Safari; export as JPG instead).')); };
        im.src = url;
      });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    var k = Math.min(1, maxDim / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); if (src.close) src.close();
    return c;
  }
  var workers = {};
  async function getWorker(langs, onProgress) {
    await loadScript(TESSERACT_URL);
    var key = langs;
    if (!workers[key]) {
      workers[key] = (async function () {
        var holder = { cb: null };
        var w = await root.Tesseract.createWorker(langs, 1, { logger: function (m) { if (holder.cb && m && m.status) holder.cb(m); } });
        w.__holder = holder; return w;
      })();
      workers[key].catch(function () { delete workers[key]; });
    }
    var w = await workers[key]; w.__holder.cb = onProgress || null; return w;
  }
  async function recognize(canvas, opt) {
    opt = opt || {}; var langs = opt.langs || 'eng+slv+hrv', w;
    try { w = await getWorker(langs, opt.onProgress); }
    catch (e) { if (langs !== 'eng') { w = await getWorker('eng', opt.onProgress); } else throw e; }
    var r = await w.recognize(canvas); return r.data;
  }
  /* whole photo -> { items (page fractions, conf >= 20), text, canvas } */
  async function ocr(fileOrCanvas, opt) {
    var canvas = fileOrCanvas instanceof HTMLCanvasElement ? fileOrCanvas : await decode(fileOrCanvas), data = await recognize(canvas, opt), W = canvas.width, H = canvas.height, items = [];
    (data.words || []).forEach(function (wd) {
      if (!wd.text || wd.confidence < 20 || !wd.bbox) return;
      items.push({ s: wd.text, x: wd.bbox.x0 / W, y: wd.bbox.y0 / H, w: (wd.bbox.x1 - wd.bbox.x0) / W, h: (wd.bbox.y1 - wd.bbox.y0) / H, p: 0 });
    });
    return { items: items, text: data.text || '', canvas: canvas };
  }
  /* OCR of one rectangle (page fractions) of a canvas: text only */
  async function ocrRegion(canvas, r, opt) {
    var pad = 4, x = Math.max(0, Math.floor(r.x * canvas.width) - pad), y = Math.max(0, Math.floor(r.y * canvas.height) - pad);
    var w = Math.min(canvas.width - x, Math.ceil(r.w * canvas.width) + pad * 2), h = Math.min(canvas.height - y, Math.ceil(r.h * canvas.height) + pad * 2);
    var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    var data = await recognize(c, opt); return (data.text || '').replace(/\s*\n\s*/g, ' ').trim();
  }
  /* a pdf.js-like document for one photo, so the same viewer can show it */
  async function asDocument(file) {
    var canvas = await decode(file, 2600), doc = { numPages: 1, isPhoto: true, canvas: canvas, ocrItems: null, destroy: function () {} };
    doc.getPage = async function () {
      return {
        getViewport: function (o) { var s = o.scale || 1; return { scale: s, width: canvas.width * s, height: canvas.height * s, transform: [s, 0, 0, s, 0, 0] }; },
        render: function (o) { var ctx = o.canvasContext; ctx.drawImage(canvas, 0, 0, o.viewport.width, o.viewport.height); return { promise: Promise.resolve() }; },
        getTextContent: async function () { return { items: [] }; }
      };
    };
    return doc;
  }
  root.InvoiceMedia = { TESSERACT_URL: TESSERACT_URL, loadScript: loadScript, isImage: isImage, decode: decode, ocr: ocr, ocrRegion: ocrRegion, recognize: recognize, asDocument: asDocument };
})(window);
