// Convert: the conversions. Every library is vendored in ./vendor/<name>-<version>/ and loaded only when a tool needs
// it; nothing is uploaded and nothing is fetched from anywhere else (pdfmake is told to refuse every URL).
// Each tool takes Files and options and returns results ({ name, blob, note }); app.mjs shows them.
import { LIMITS as ESLOG_LIMITS, gridFromPdfPages, gridFromSheet } from './eslog/extract.mjs';
import {
  A4, HTML_STYLES, baseName, cleanText, cellValue, decodeText, expand, ext, fitContent, fitRect, guessDecimal, jpegOrientation,
  markHeadings, outName, pad, pageFor, pageParagraphs, pagesToText, parseRanges, plainError, rangeLabel, readCsv,
  renderScale, sheetName, shrinkTo, sniff, tableDoc, textDoc, pagesToXml, pdfTable, rowsToXml, xmlToRows,
} from './lib.mjs';

const at = (p) => new URL('./vendor/' + p, import.meta.url).href;
const once = (fn) => { let p = null; return () => (p ||= fn().catch((e) => { p = null; throw e; })); };
function loadError(label) { return plainError(`Part of Convert (${label}) could not be loaded. Check the connection and try again; if it keeps failing, reload the page (you may have to sign in again).`); }
const script = (path, label) => new Promise((resolve, reject) => {
  const s = document.createElement('script'); s.src = at(path); s.async = true;
  s.onload = () => resolve(); s.onerror = () => { s.remove(); reject(loadError(label)); };
  document.head.appendChild(s);
});
const esm = (path, label) => import(at(path)).catch(() => { throw loadError(label); });

// the libraries, each fetched on first use and kept for the rest of the visit
export const LIB = {
  pdfLib: once(() => esm('pdf-lib-1.17.1/pdf-lib.esm.min.js', 'pdf-lib')),
  pdfjs: once(async () => { const m = await esm('pdfjs-6.3.289/pdf.min.mjs', 'pdf.js'); m.GlobalWorkerOptions.workerSrc = at('pdfjs-6.3.289/pdf.worker.min.mjs'); return m; }),
  pdfmake: once(async () => {
    await script('pdfmake-0.3.11/pdfmake.min.js', 'pdfmake'); await script('pdfmake-0.3.11/vfs_fonts.js', 'pdfmake fonts');
    window.pdfMake.setUrlAccessPolicy(() => false); // pictures come as data: URLs; never fetch one from the web
    return window.pdfMake;
  }),
  htmlToPdfmake: once(() => script('html-to-pdfmake-2.5.34/browser.js', 'html-to-pdfmake').then(() => window.htmlToPdfmake)),
  mammoth: once(() => script('mammoth-1.13.0/mammoth.browser.min.js', 'mammoth').then(() => window.mammoth)),
  docx: once(() => esm('docx-9.8.1/docx.mjs', 'docx')),
  jszip: once(() => script('jszip-3.10.1/jszip.min.js', 'JSZip').then(() => window.JSZip)),
  marked: once(() => esm('marked-18.0.14/marked.esm.js', 'marked')),
  xlsx: once(() => script('xlsx-0.20.3/xlsx.full.min.js', 'SheetJS').then(() => window.XLSX)),
};

export const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv;charset=utf-8', txt: 'text/plain;charset=utf-8', png: 'image/png', zip: 'application/zip', xml: 'application/xml;charset=utf-8' };
const blobOf = (data, kind) => new Blob([data], { type: MIME[kind] });
const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());
const tick = () => new Promise((r) => setTimeout(r, 16)); // lets the page paint the progress before long synchronous work

/** Several results as one ZIP (pictures and PDFs are stored, text is compressed). */
export async function zipOf(results, name) {
  const JSZip = await LIB.jszip(), zip = new JSZip();
  for (const r of results) zip.file(r.name, r.blob, { compression: /^(text|application\/vnd|application\/json)/.test(r.blob.type) ? 'DEFLATE' : 'STORE' });
  return { name, blob: await zip.generateAsync({ type: 'blob', mimeType: MIME.zip }) };
}
const pdfFromDoc = async (doc) => (await LIB.pdfmake()).createPdf(doc).getBlob();

// ── PDF reading (pdf.js) ────────────────────────────────────────────────────────────────────────────────
/** Opens a PDF with pdf.js; asks for the password when it has one (ctx.password). */
async function openPdf(file, ctx) {
  const pdfjs = await LIB.pdfjs(), data = await bytesOf(file);
  if (sniff(data) !== 'pdf') throw plainError(`${file.name} is not a PDF.`);
  const task = pdfjs.getDocument({
    data, cMapUrl: at('pdfjs-6.3.289/cmaps/'), cMapPacked: true, standardFontDataUrl: at('pdfjs-6.3.289/standard_fonts/'),
    wasmUrl: at('pdfjs-6.3.289/wasm/'), iccUrl: at('pdfjs-6.3.289/iccs/'), isEvalSupported: false, enableXfa: false,
  });
  task.onPassword = async (update, reason) => {
    const pw = await ctx.password(file.name, reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    if (pw == null) { task.destroy(); return; }
    update(pw);
  };
  try { return await task.promise; } catch (e) {
    if (task.destroyed && !(e && e.name === 'InvalidPDFException')) throw plainError(`${file.name} needs its password to be opened.`);
    throw e;
  }
}

/** The text of every page as paragraphs; with `styles`, bold and italic are read from the fonts too (that needs the
 * page's drawing commands, so only pages that have text pay for it). */
async function pdfText(file, ctx, { styles = false } = {}) {
  const doc = await openPdf(file, ctx), pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      ctx.progress(`Reading page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n), tc = await page.getTextContent(), fonts = {};
      const text = tc.items.filter((it) => typeof it.str === 'string');
      if (styles && text.some((it) => it.str.trim())) {
        await page.getOperatorList();
        for (const id of new Set(text.map((it) => it.fontName))) {
          try { const f = page.commonObjs.get(id); fonts[id] = { bold: Boolean(f.bold) || /bold|black|heavy|semibold|demi|medium/i.test(f.name || ''), italic: Boolean(f.italic) || /italic|oblique/i.test(f.name || '') }; } catch { /* not loaded: plain */ }
        }
      }
      pages.push(pageParagraphs(text.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.hypot(it.transform[2], it.transform[3]) || it.height, eol: it.hasEOL, ...fonts[it.fontName] }))));
      page.cleanup();
    }
  } finally { doc.loadingTask.destroy(); } // pdf.js 6: the document is closed through its loading task
  if (!pages.some((p) => p.length)) throw plainError(`${file.name} has no text to read: it looks like a scan or pictures only, and Convert cannot read text inside pictures.`);
  return markHeadings(pages);
}
const emptyNote = (pages) => { const n = pages.filter((p) => !p.length).length; return n ? `${n} ${n === 1 ? 'page has' : 'pages have'} no text (scans or pictures only).` : ''; };

// ── pictures in the browser ─────────────────────────────────────────────────────────────────────────────
/** Decodes a picture the browser can show; drawing it later applies the EXIF orientation, as browsers do. */
async function loadImage(src) {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src), img = new Image();
  try { // onload, not img.decode(): Chrome holds decode() back while the tab is in the background
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('not a picture this browser can read')); img.src = url; });
    if (!img.naturalWidth) throw new Error('empty picture');
    return img;
  } finally { if (url !== src) URL.revokeObjectURL(url); }
}
/** The picture on a canvas, its long side at most `max` px; `opaque` puts it on white (for JPEG, which has no
 * transparency and would turn it black). */
function toCanvas(img, max = 3200, opaque = false) {
  const [w, h] = shrinkTo(img.naturalWidth, img.naturalHeight, max), canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  if (opaque) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.drawImage(img, 0, 0, w, h);
  return canvas;
}
const canvasBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new RangeError('canvas too large'))), type, quality));
const release = (canvas) => { canvas.width = 0; canvas.height = 0; }; // frees the memory at once (iPhone Safari counts it)

// ── the tools ───────────────────────────────────────────────────────────────────────────────────────────
/** Word (.docx) → PDF: mammoth makes clean HTML (headings, paragraphs, bold, italic, lists, tables, pictures),
 * html-to-pdfmake turns it into a pdfmake document, pdfmake writes real text with Roboto embedded. */
async function wordPdf(file, opts, ctx) {
  const data = await file.arrayBuffer(), kind = sniff(new Uint8Array(data).subarray(0, 16));
  if (kind === 'cfb') throw plainError(`${file.name} is an old .doc file or has a password. Open it in Word or Pages, save it as a .docx without a password and try again.`);
  if (kind !== 'zip') throw plainError(`${file.name} is not a Word .docx file.`);
  const [mammoth, htmlToPdfmake] = await Promise.all([LIB.mammoth(), LIB.htmlToPdfmake(), LIB.pdfmake()]);
  ctx.progress(`Reading ${file.name}`);
  let dropped = 0;
  const convertImage = mammoth.images.imgElement(async (image) => {
    try {
      const src = `data:${image.contentType};base64,${await image.read('base64')}`, img = await loadImage(src);
      const width = String(Math.min(img.naturalWidth, 640)); // 640 px is the width of the text
      if (/^image\/(png|jpeg)$/.test(image.contentType)) return { src, width };
      const canvas = toCanvas(img, 2000), png = canvas.toDataURL('image/png'); // pdfmake draws only PNG and JPEG
      release(canvas);
      return { src: png, width };
    } catch { dropped++; return { src: '' }; } // EMF, WMF, TIFF …: browsers cannot draw them
  });
  const { value } = await mammoth.convertToHtml({ arrayBuffer: data }, { convertImage, styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] });
  const html = value.replace(/<img\b[^>]*\bsrc=""[^>]*>/g, '');
  if (!html.replace(/<[^>]+>/g, '').trim() && !/<img/.test(html)) throw plainError(`${file.name} has no text to convert.`);
  ctx.progress(`Writing ${outName(file.name, 'pdf')}`); await tick();
  const content = fitContent(htmlToPdfmake(html, { defaultStyles: HTML_STYLES, removeExtraBlanks: true }), A4[0] - 112, A4[1] - 140);
  const blob = await pdfFromDoc({ pageSize: 'A4', pageMargins: [56, 56, 56, 60], info: { title: baseName(file.name) }, content, defaultStyle: { fontSize: 11, lineHeight: 1.25 }, footer: (p, n) => ({ text: `${p} / ${n}`, alignment: 'center', fontSize: 8, color: '#7a8394', margin: [0, 18, 0, 0] }) });
  return [{ name: outName(file.name, 'pdf'), blob, note: dropped ? `${dropped} ${dropped === 1 ? 'picture' : 'pictures'} in a format browsers cannot draw (such as EMF) left out.` : '' }];
}

/** PDF → Word (.docx): pdf.js text grouped into paragraphs per page (headings guessed from the text size, bold and
 * italic from the fonts), a page break between pages, written with the docx library. */
async function pdfWord(file, opts, ctx) {
  const pages = await pdfText(file, ctx, { styles: true });
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await LIB.docx();
  ctx.progress(`Writing ${outName(file.name, 'docx')}`); await tick();
  const children = pages.flatMap((paras, pi) => (paras.length ? paras : [{ runs: [], heading: 0 }]).map((p, i) => new Paragraph({
    pageBreakBefore: pi > 0 && i === 0,
    heading: p.heading === 1 ? HeadingLevel.HEADING_1 : p.heading === 2 ? HeadingLevel.HEADING_2 : undefined,
    spacing: { after: 120 },
    children: p.runs.map((r) => new TextRun({ text: r.text, bold: r.bold || undefined, italics: r.italic || undefined })),
  })));
  const doc = new Document({ creator: 'Convert (Business Apps)', title: baseName(file.name), styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 } } }, children }] });
  return [{ name: outName(file.name, 'docx'), blob: await Packer.toBlob(doc), note: emptyNote(pages) }];
}

/** PDF → text (.txt): the lines of every page, paragraphs apart, pages divided by a form feed. */
async function pdfTextTool(file, opts, ctx) {
  const pages = await pdfText(file, ctx);
  return [{ name: outName(file.name, 'txt'), blob: blobOf(pagesToText(pages) + '\n', 'txt'), note: emptyNote(pages) }];
}

/** PDF → PNG pictures, one per page (all pages or the ones asked for), zipped when there is more than one. */
async function pdfImages(file, opts, ctx) {
  const doc = await openPdf(file, ctx), out = [], dpi = Number(opts.dpi) || 150;
  try {
    const list = String(opts.pages || '').trim() ? expand(parseRanges(opts.pages, doc.numPages)) : expand([{ from: 1, to: doc.numPages }]);
    for (const [k, n] of list.entries()) {
      ctx.progress(`Drawing page ${n} (${k + 1} of ${list.length})`);
      const page = await doc.getPage(n), base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: renderScale(base.width, base.height, dpi) });
      const canvas = document.createElement('canvas'); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      try {
        // the print intent draws without waiting for animation frames, so it keeps going while the tab is in the background
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff', intent: 'print' }).promise;
        out.push({ name: `${baseName(file.name)}-page-${pad(n, doc.numPages)}.png`, blob: await canvasBlob(canvas, MIME.png) });
      } finally { release(canvas); page.cleanup(); }
    }
  } finally { doc.loadingTask.destroy(); } // pdf.js 6: the document is closed through its loading task
  if (out.length === 1) return out;
  ctx.progress('Zipping the pictures');
  return [await zipOf(out, `${baseName(file.name)}-images.zip`)];
}

/** Pictures → one PDF, a page each in the list's order, fitted on A4. JPEG and PNG go in as they are (no quality
 * lost); sideways phone photos, WEBP, GIF, BMP and HEIC are redrawn first. */
async function imagesPdf(files, opts, ctx) {
  const { PDFDocument } = await LIB.pdfLib(), pdf = await PDFDocument.create(), margin = { none: 0, small: 20, big: 40 }[opts.margin] ?? 20;
  for (const [i, file] of files.entries()) {
    ctx.progress(`Adding picture ${i + 1} of ${files.length}`);
    const bytes = await bytesOf(file), kind = sniff(bytes);
    if (!['jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'avif'].includes(kind)) throw plainError(`${file.name} is not a picture Convert can read (JPG, PNG or WEBP).`);
    let img = null;
    if (kind === 'jpeg' && jpegOrientation(bytes) === 1) img = await pdf.embedJpg(bytes).catch(() => null);
    else if (kind === 'png') img = await pdf.embedPng(bytes).catch(() => null);
    if (!img) {
      let picture;
      try { picture = await loadImage(file); } catch { throw plainError(kind === 'heic' ? `${file.name} is a HEIC photo this browser cannot read. On iPhone pick it from Photos (it arrives as JPEG), or set Settings › Camera › Formats to Most Compatible.` : `${file.name} could not be read as a picture.`); }
      const png = kind === 'png' || kind === 'gif' || kind === 'bmp', canvas = toCanvas(picture, 3200, !png); // PNG keeps transparency, photos go in as JPEG
      try { const b = await bytesOf(await canvasBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.92)); img = png ? await pdf.embedPng(b) : await pdf.embedJpg(b); } finally { release(canvas); }
    }
    const [pw, ph] = pageFor(img.width, img.height, opts.page), page = pdf.addPage([pw, ph]);
    page.drawImage(img, fitRect(img.width, img.height, pw, ph, margin));
  }
  pdf.setTitle(baseName(files[0].name)); pdf.setCreator('Convert (Business Apps)');
  ctx.progress('Saving the PDF'); await tick();
  return [{ name: files.length === 1 ? outName(files[0].name, 'pdf') : `${baseName(files[0].name)} and ${files.length - 1} more.pdf`, blob: blobOf(await pdf.save(), 'pdf') }];
}

/** A PDF opened with pdf-lib, with a plain message for protected ones (their pages cannot be copied). */
async function loadPdf(PDFDocument, file) {
  const bytes = await bytesOf(file);
  if (sniff(bytes) !== 'pdf') throw plainError(`${file.name} is not a PDF.`);
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); } catch (e) {
    if (/encrypt/i.test(`${e && e.name} ${e && e.message}`)) throw plainError(`${file.name} is protected (encrypted), so its pages cannot be copied. Open it and print it to a new PDF (Print › Save as PDF), then try again.`);
    throw plainError(`${file.name} could not be read: it is damaged or uses something this tool does not support.`);
  }
}

/** Merge: the pages of every PDF, in the list's order, into one. */
async function merge(files, opts, ctx) {
  const { PDFDocument } = await LIB.pdfLib(), out = await PDFDocument.create();
  for (const [i, file] of files.entries()) {
    ctx.progress(`Adding ${file.name} (${i + 1} of ${files.length})`);
    const src = await loadPdf(PDFDocument, file);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  out.setTitle(baseName(files[0].name)); out.setCreator('Convert (Business Apps)');
  ctx.progress('Saving the PDF'); await tick();
  return [{ name: `${baseName(files[0].name)} merged.pdf`, blob: blobOf(await out.save(), 'pdf'), note: `${out.getPageCount()} pages from ${files.length} files.` }];
}

/** Split: every page as its own PDF, or the pages asked for, as one PDF or one per range. Several files are zipped. */
async function split(files, opts, ctx) {
  const { PDFDocument } = await LIB.pdfLib(), file = files[0], src = await loadPdf(PDFDocument, file), count = src.getPageCount(), base = baseName(file.name);
  let groups;
  if (opts.mode === 'pages') { const ranges = parseRanges(opts.pages, count); groups = opts.separate ? ranges.map((r) => [r]) : [ranges]; }
  else groups = Array.from({ length: count }, (_, i) => [{ from: i + 1, to: i + 1 }]);
  const out = [];
  for (const [k, g] of groups.entries()) {
    ctx.progress(`Making PDF ${k + 1} of ${groups.length}`);
    const doc = await PDFDocument.create(), pages = expand(g);
    for (const p of await doc.copyPages(src, pages.map((n) => n - 1))) doc.addPage(p);
    const name = pages.length === 1 ? `${base}-page-${pad(pages[0], count)}.pdf` : `${base}-pages-${rangeLabel(g)}.pdf`;
    out.push({ name, blob: blobOf(await doc.save(), 'pdf') });
    if (k % 10 === 9) await tick();
  }
  if (out.length === 1) return out;
  ctx.progress('Zipping the PDFs');
  return [{ ...(await zipOf(out, `${base}-split.zip`)), note: `${out.length} PDFs.` }];
}

/** CSV rows from a file, decoded (UTF-8, UTF-16 or Windows-1250) with the delimiter found or chosen. */
async function csvRows(file, opts) {
  const { text } = decodeText(await bytesOf(file));
  const { rows, delimiter } = readCsv(text, { delimiter: opts.delimiter, ext: ext(file.name) });
  if (!rows.length) throw plainError(`${file.name} is empty.`);
  return { rows, delimiter };
}

/** CSV → PDF: one table, header row repeated on every page, page numbers, landscape when it is wide. */
async function csvPdf(file, opts, ctx) {
  const { rows } = await csvRows(file, opts);
  await LIB.pdfmake();
  ctx.progress(`Writing ${outName(file.name, 'pdf')} (${rows.length.toLocaleString('en-GB')} rows)`); await tick();
  return [{ name: outName(file.name, 'pdf'), blob: await pdfFromDoc(tableDoc({ title: file.name, sections: [{ name: file.name, rows, header: opts.header !== false }], orientation: opts.orientation })) }];
}

/** CSV → Excel: one sheet; numbers become numbers (leading zeros and long digit strings stay text). */
async function csvExcel(file, opts, ctx) {
  const { rows, delimiter } = await csvRows(file, opts), XLSX = await LIB.xlsx();
  ctx.progress(`Writing ${outName(file.name, 'xlsx')}`); await tick();
  const decimal = guessDecimal(rows, delimiter), width = Math.max(...rows.map((r) => r.length));
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (opts.numbers === false ? v : cellValue(v, decimal)))));
  ws['!cols'] = Array.from({ length: width }, (_, c) => ({ wch: Math.min(50, Math.max(6, ...rows.slice(0, 1000).map((r) => String(r[c] ?? '').length + 1))) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName(baseName(file.name)));
  return [{ name: outName(file.name, 'xlsx'), blob: blobOf(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }), 'xlsx') }];
}

/** The visible sheets of a workbook that have something in them, as rows of the cells' shown text. */
async function sheets(file, ctx) {
  const XLSX = await LIB.xlsx(), data = await bytesOf(file);
  ctx.progress(`Reading ${file.name}`); await tick();
  let wb;
  try { wb = XLSX.read(data, { type: 'array', dense: true }); } catch (e) {
    if (/password|encrypt/i.test(String(e && e.message))) throw plainError(`${file.name} has a password. Open it in Excel, remove the password (File › Info › Protect Workbook) and try again.`);
    throw plainError(`${file.name} could not be read as a spreadsheet: it is damaged or not an Excel file.`);
  }
  const list = wb.SheetNames.map((name, i) => ({ name, hidden: wb.Workbook?.Sheets?.[i]?.Hidden, ws: wb.Sheets[name] })).filter((s) => !s.hidden && s.ws)
    .map((s) => ({ ...s, rows: XLSX.utils.sheet_to_json(s.ws, { header: 1, raw: false, defval: '', blankrows: false }).map((r) => r.map((v) => cleanText(v))) }))
    .filter((s) => s.rows.some((r) => r.some((v) => String(v).trim())));
  if (!list.length) throw plainError(`${file.name} has no filled cells.`);
  return { XLSX, list };
}

/** Excel → PDF: every visible sheet as a table on its own pages (landscape when it is wide). */
async function excelPdf(file, opts, ctx) {
  const { list } = await sheets(file, ctx);
  await LIB.pdfmake();
  ctx.progress(`Writing ${outName(file.name, 'pdf')}`); await tick();
  const blob = await pdfFromDoc(tableDoc({ title: file.name, sections: list.map((s) => ({ name: list.length > 1 ? s.name : `${file.name} · ${s.name}`, rows: s.rows, header: opts.header !== false })), orientation: opts.orientation }));
  return [{ name: outName(file.name, 'pdf'), blob, note: list.length > 1 ? `${list.length} sheets.` : '' }];
}

/** Excel → CSV: one UTF-8 CSV per visible sheet (with a BOM, so Excel reads the letters right when it opens it). */
async function excelCsv(file, opts, ctx) {
  const { XLSX, list } = await sheets(file, ctx), sep = opts.sep === ';' ? ';' : opts.sep === '\t' ? '\t' : ',';
  return list.map((s) => ({ name: list.length > 1 ? `${baseName(file.name)} - ${sheetName(s.name).replace(/\s+/g, ' ')}.csv` : outName(file.name, 'csv'), blob: blobOf('﻿' + XLSX.utils.sheet_to_csv(s.ws, { FS: sep, blankrows: false }), 'csv') }));
}

/** Text → PDF: Markdown (headings, lists, tables, code, links) through marked and html-to-pdfmake; plain text as
 * it is. Pictures linked from the web are left out: Convert never downloads anything. */
async function textPdf(file, opts, ctx) {
  const { text } = decodeText(await bytesOf(file)), md = /\.(md|markdown)$/i.test(file.name);
  if (!text.trim()) throw plainError(`${file.name} is empty.`);
  if (!md) { await LIB.pdfmake(); ctx.progress(`Writing ${outName(file.name, 'pdf')}`); await tick(); return [{ name: outName(file.name, 'pdf'), blob: await pdfFromDoc(textDoc(text, file.name)) }]; }
  const [{ marked }, htmlToPdfmake] = await Promise.all([LIB.marked(), LIB.htmlToPdfmake(), LIB.pdfmake()]);
  let dropped = 0;
  const html = marked.parse(text.replace(/^﻿/, ''), { gfm: true, async: false }).replace(/<img\b[^>]*>/gi, (tag) => (/\bsrc="data:image\/(png|jpe?g);/i.test(tag) ? tag : (dropped++, '')));
  ctx.progress(`Writing ${outName(file.name, 'pdf')}`); await tick();
  const content = fitContent(htmlToPdfmake(html, { defaultStyles: HTML_STYLES, removeExtraBlanks: true }), A4[0] - 112, A4[1] - 140);
  const blob = await pdfFromDoc({ pageSize: 'A4', pageMargins: [56, 56, 56, 60], info: { title: baseName(file.name) }, content, defaultStyle: { fontSize: 11, lineHeight: 1.3 }, footer: (p, n) => ({ text: `${p} / ${n}`, alignment: 'center', fontSize: 8, color: '#7a8394', margin: [0, 18, 0, 0] }) });
  return [{ name: outName(file.name, 'pdf'), blob, note: dropped ? `${dropped} linked ${dropped === 1 ? 'picture' : 'pictures'} left out (Convert does not download anything).` : '' }];
}

// ── data and XML ────────────────────────────────────────────────────────────────────────────────────────
/** The positioned text items of every page of a PDF (for table guessing). */
async function pdfItems(file, ctx) {
  const doc = await openPdf(file, ctx), pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      ctx.progress(`Reading page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n), tc = await page.getTextContent();
      pages.push(tc.items.filter((it) => typeof it.str === 'string').map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.hypot(it.transform[2], it.transform[3]) || it.height })));
      page.cleanup();
    }
  } finally { doc.loadingTask.destroy(); }
  if (!pages.some((p) => p.some((it) => it.str.trim()))) throw plainError(`${file.name} has no text to read: it looks like a scan or pictures only, and Convert cannot read text inside pictures.`);
  return pages;
}
const PREVIEW_ROWS = 10;

/** PDF → Excel: rows and columns guessed from where the text sits (see pdfTable); numbers become numbers; one sheet
 * per page or everything on one sheet. Works on tables made by a computer, not on scans. */
async function pdfExcel(file, opts, ctx) {
  const pages = await pdfItems(file, ctx), XLSX = await LIB.xlsx();
  ctx.progress('Finding the tables'); await tick();
  const tables = pages.map((items) => pdfTable(items)), found = tables.filter((t) => t.tableRows >= 2).length;
  if (!tables.some((t) => t.rows.length)) throw plainError(`${file.name} has no text to turn into rows.`);
  const wb = XLSX.utils.book_new(), perPage = opts.sheets === 'page';
  const decimal = guessDecimal(tables.flatMap((t) => t.rows), ';');
  const toSheet = (rows) => {
    const width = Math.max(1, ...rows.map((r) => r.length)), ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => cellValue(v, decimal))));
    ws['!cols'] = Array.from({ length: width }, (_, c) => ({ wch: Math.min(50, Math.max(6, ...rows.slice(0, 500).map((r) => String(r[c] ?? '').length + 1))) }));
    return ws;
  };
  let preview;
  if (perPage) {
    tables.forEach((t, i) => { if (!t.rows.length) return; XLSX.utils.book_append_sheet(wb, toSheet(t.rows), sheetName(`Page ${i + 1}`)); preview ||= t.rows; });
  } else {
    const all = tables.flatMap((t) => t.rows);
    XLSX.utils.book_append_sheet(wb, toSheet(all), sheetName(baseName(file.name))); preview = all;
  }
  const notes = [`${found} of ${pages.length} ${pages.length === 1 ? 'page has' : 'pages have'} a table.`];
  if (!found) notes[0] = 'No table was found: every line of text is a row.';
  const empty = emptyNote(pages.map((p) => (p.some((it) => it.str.trim()) ? [1] : [])));
  if (empty) notes.push(empty);
  return [{ name: outName(file.name, 'xlsx'), blob: blobOf(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }), 'xlsx'), note: notes.join(' '), preview: preview.slice(0, PREVIEW_ROWS) }];
}

/** Excel or CSV → XML: one file per sheet, <rows><row><Header_Name>…</Header_Name></row></rows>. */
async function excelXml(file, opts, ctx) {
  const csv = ['csv', 'tsv'].includes(ext(file.name));
  const list = csv ? [{ name: baseName(file.name), rows: (await csvRows(file, { delimiter: 'auto' })).rows }] : (await sheets(file, ctx)).list;
  ctx.progress(`Writing ${outName(file.name, 'xml')}`); await tick();
  return list.map((s) => ({
    name: list.length > 1 ? `${baseName(file.name)} - ${sheetName(s.name).replace(/\s+/g, ' ')}.xml` : outName(file.name, 'xml'),
    blob: blobOf(rowsToXml(s.rows, { header: opts.header !== false }).xml, 'xml'),
    note: `${Math.max(0, s.rows.length - (opts.header !== false ? 1 : 0)).toLocaleString('en-GB')} rows`,
  }));
}

/** XML → Excel: the repeated records as rows (see xmlToRows), one sheet. */
async function xmlExcel(file, opts, ctx) {
  const { text } = decodeText(await bytesOf(file)), XLSX = await LIB.xlsx();
  ctx.progress(`Reading ${file.name}`); await tick();
  const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) throw plainError(`${file.name} is not valid XML (it may be cut off or have a stray character).`);
  const r = xmlToRows(doc);
  if (!r.rows.length || !r.headers.length) throw plainError(`${file.name} has no records to turn into rows.`);
  const decimal = guessDecimal(r.rows, ';'), rows = [r.headers, ...r.rows.map((row) => row.map((v) => cellValue(v, decimal)))];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = r.headers.map((h, c) => ({ wch: Math.min(50, Math.max(6, h.length + 1, ...r.rows.slice(0, 500).map((row) => String(row[c] ?? '').length + 1))) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName(r.record));
  const notes = [`${r.count.toLocaleString('en-GB')} <${r.record}> records as rows.`];
  if (r.flattened) notes.push(`Nested elements were flattened into ${r.flattened} columns named parent/child.`);
  if (r.merged) notes.push(`Repeated values were joined with “; ” in ${r.merged} ${r.merged === 1 ? 'cell' : 'cells'}.`);
  return [{ name: outName(file.name, 'xlsx'), blob: blobOf(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }), 'xlsx'), note: notes.join(' '), warn: Boolean(r.flattened || r.merged), preview: [r.headers, ...r.rows].slice(0, PREVIEW_ROWS + 1) }];
}

/** PDF → XML: <document><page n="1"><p>…</p></page></document>, the paragraphs of every page. Text only. */
async function pdfXml(file, opts, ctx) {
  const pages = await pdfText(file, ctx);
  ctx.progress(`Writing ${outName(file.name, 'xml')}`); await tick();
  return [{ name: outName(file.name, 'xml'), blob: blobOf(pagesToXml(pages), 'xml'), note: emptyNote(pages) }];
}

/** An invoice file for the eSLOG tool: Excel (every visible sheet) or a text-layer PDF, as grids of cells (see
 * eslog/extract.mjs). Nothing is run: formulas are not evaluated, only the stored values are read. */
export async function readInvoiceFile(file, ctx) {
  if (file.size > ESLOG_LIMITS.fileBytes) throw plainError(`${file.name} is larger than ${ESLOG_LIMITS.fileBytes / 1048576} MB, which is too big for an invoice. Check that it is the right file.`);
  const data = await bytesOf(file), kind = sniff(data.subarray(0, 16));
  if (kind === 'pdf') {
    const doc = await openPdf(file, ctx), pages = [];
    try {
      for (let n = 1; n <= Math.min(doc.numPages, ESLOG_LIMITS.pdfPages); n++) {
        ctx.progress(`Reading page ${n} of ${doc.numPages}`);
        const page = await doc.getPage(n), tc = await page.getTextContent();
        pages.push(tc.items.filter((it) => typeof it.str === 'string').map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.hypot(it.transform[2], it.transform[3]) || it.height })));
        page.cleanup();
      }
      const note = doc.numPages > ESLOG_LIMITS.pdfPages ? `Only the first ${ESLOG_LIMITS.pdfPages} pages were read.` : '';
      return { kind: 'pdf', grids: [{ name: 'PDF', grid: gridFromPdfPages(pages) }], note };
    } finally { doc.loadingTask.destroy(); }
  }
  if (kind !== 'zip' && kind !== 'cfb' && !(ext(file.name) === 'ods')) throw plainError(`${file.name} is not an Excel or PDF file.`);
  const XLSX = await LIB.xlsx();
  ctx.progress(`Reading ${file.name}`); await tick();
  let wb;
  try { wb = XLSX.read(data, { type: 'array', dense: true, cellFormula: false, cellHTML: false, cellNF: true, sheetRows: ESLOG_LIMITS.rows + 1 }); } catch (e) {
    if (/password|encrypt/i.test(String(e && e.message))) throw plainError(`${file.name} has a password. Open it in Excel, remove the password (File › Info › Protect Workbook) and try again.`);
    throw plainError(`${file.name} could not be read as a spreadsheet: it is damaged or not an Excel file.`);
  }
  const grids = wb.SheetNames.map((name, i) => ({ name, hidden: wb.Workbook?.Sheets?.[i]?.Hidden, ws: wb.Sheets[name] })).filter((s) => !s.hidden && s.ws)
    .map((s) => ({ name: s.name, grid: gridFromSheet(XLSX, s.ws) })).filter((s) => s.grid.some((r) => r.some((v) => String(v).trim())));
  if (!grids.length) throw plainError(`${file.name} has no filled cells.`);
  return { kind: 'xlsx', grids, note: '' };
}

// each: one result list per file; all: every file together
export const RUN = {
  'word-pdf': { each: wordPdf }, 'pdf-word': { each: pdfWord }, 'pdf-text': { each: pdfTextTool }, 'pdf-img': { each: pdfImages },
  'img-pdf': { all: imagesPdf }, merge: { all: merge }, split: { all: split },
  'csv-pdf': { each: csvPdf }, 'csv-excel': { each: csvExcel }, 'excel-pdf': { each: excelPdf }, 'excel-csv': { each: excelCsv }, 'text-pdf': { each: textPdf },
  'pdf-excel': { each: pdfExcel }, 'excel-xml': { each: excelXml }, 'xml-excel': { each: xmlExcel }, 'pdf-xml': { each: pdfXml },
};

/** Page count of a PDF for the file list (pdf-lib, cheap): null when it cannot tell. */
export async function pageCount(file) {
  try { const { PDFDocument } = await LIB.pdfLib(); return (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false })).getPageCount(); } catch { return null; }
}
