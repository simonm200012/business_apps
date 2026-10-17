// Convert: files converted in the browser, like the online converters, but nothing is uploaded: CSV, Excel, Word, text and
// pictures to PDF, PDF to Word, pictures or text, CSV and Excel both ways, merge and split PDFs. Drop files on the big
// zone and the tools that fit light up (a single fit opens straight away); each tool has its own page (#<tool id>,
// so Back works), a reorderable file list where order matters, a few options, and the results with a Download button
// each, Download all, and Share on phones. The conversions are in tools.mjs, the pure helpers in lib.mjs.
import { toolsUi } from './ui.mjs';
import { TOOLS, GROUPS, FORMATS, tool, ext, fits, toolsFor, unsupportedHint, uniqueName, formatBytes, friendlyError } from './lib.mjs';
import { RUN, zipOf, pageCount } from './tools.mjs';

const { $, esc, toast, formDialog } = toolsUi;
const main = $('#main');
const state = { view: null, files: [], pending: [], results: [], busy: false, filter: 'all', opts: {} };
let seq = 0;
const LABEL = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV', img: 'JPG · PNG', png: 'PNG', txt: 'TXT', md: 'TXT · MD', xml: 'XML' };
const RUN_LABEL = { merge: 'Merge PDFs', split: 'Split PDF', png: 'Convert to images', txt: 'Convert to text' };
const TAKES = { pdf: 'PDF files', docx: 'Word .docx files', csv: '.csv or .tsv files', xlsx: 'Excel files (.xlsx, .xls, .ods)', img: 'JPG, PNG or WEBP pictures', md: '.txt or .md files', xml: '.xml files' };
const MIMES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel', img: 'image/*', md: 'text/plain,text/markdown', xml: 'application/xml,text/xml' };
const ALL_ACCEPT = [...new Set(TOOLS.flatMap((t) => t.accept))].map((e) => '.' + e).concat('application/pdf', 'image/*', 'text/csv', 'text/plain', 'application/xml', 'text/xml').join(',');
const DEFAULTS = { 'csv-pdf': { orientation: 'auto', header: true, delimiter: 'auto' }, 'csv-excel': { delimiter: 'auto', numbers: true }, 'excel-pdf': { orientation: 'auto', header: true }, 'excel-csv': { sep: ',' }, 'pdf-img': { dpi: '150', pages: '' }, 'img-pdf': { page: 'auto', margin: 'small' }, split: { mode: 'every', pages: '', separate: false }, 'pdf-excel': { sheets: 'one' }, 'excel-xml': { header: true } };
const canShare = (() => { try { return matchMedia('(pointer: coarse)').matches && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }); } catch { return false; } })();

const GLYPH = {
  doc: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/><path d="M9 12h6M9 15h6M9 18h3.5"/>',
  edit: '<path d="M11 20.5H6.5v-17h7l4 4V11"/><path d="M13.5 3.5v4h4"/><path d="M9 12h4M9 15h2"/><path d="M14 20.5l.6-2.8 4.6-4.6a1.4 1.4 0 0 1 2 2l-4.6 4.6z"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17.5l5-4.5 3.5 3 2.5-2 5 4"/>',
  images: '<rect x="7" y="3.5" width="13.5" height="12" rx="2"/><path d="M3.5 8v10.5a2 2 0 0 0 2 2H16"/><path d="M7.5 13.5l3.5-3 2.5 2 2-1.5 4.5 3.5"/>',
  merge: '<path d="M6 3.5V7a5 5 0 0 0 5 5h1"/><path d="M18 3.5V7a5 5 0 0 1-5 5h-1v8"/><path d="M9 17.5l3 3 3-3"/>',
  split: '<circle cx="6.5" cy="7" r="2.6"/><circle cx="6.5" cy="17" r="2.6"/><path d="M8.7 8.5L20 16.5M8.7 15.5L20 7.5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10"/>',
  sheet: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.2 4.5v15M14.8 4.5v15"/>',
  text: '<path d="M5 7V5h14v2"/><path d="M12 5v14M9.5 19h5"/>',
  type: '<path d="M4 6.5h16M4 11.5h11M4 16.5h7"/><path d="M18 13v7M16.3 13h3.4M16.3 20h3.4"/>',
  upload: '<path d="M12 16V4.5"/><path d="M7.5 9l4.5-4.5L16.5 9"/><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5M13.5 5l-3 14"/>',
  grip: '<circle cx="9" cy="6.5" r="1.3"/><circle cx="15" cy="6.5" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="17.5" r="1.3"/><circle cx="15" cy="17.5" r="1.3"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[name]}</svg>`;
const colours = (t) => `--a:${FORMATS[t.from].color};--b:${t.color || FORMATS[t.to].color}`;
const pair = (t) => `<span class="tool-pair" aria-label="${esc(LABEL[t.from])} to ${esc(LABEL[t.to])}"><b style="--f:${FORMATS[t.from].color}">${esc(LABEL[t.from])}</b><i aria-hidden="true">→</i><b style="--f:${t.color || FORMATS[t.to].color}">${esc(LABEL[t.to])}</b></span>`;
const kindOf = (name) => { const e = ext(name); return e === 'pdf' ? 'pdf' : e === 'docx' ? 'docx' : ['xlsx', 'xls', 'xlsm', 'ods'].includes(e) ? 'xlsx' : ['csv', 'tsv'].includes(e) ? 'csv' : ['txt', 'md', 'markdown'].includes(e) ? 'txt' : e === 'zip' ? 'zip' : e === 'xml' ? 'xml' : 'img'; };
const badge = (name) => `<span class="badge" style="--f:${FORMATS[kindOf(name)].color}" aria-hidden="true">${esc((ext(name) || 'file').slice(0, 4).toUpperCase())}</span>`;
const dropZone = (title, sub, compact = false) => `<div class="drop${compact ? ' compact' : ''}" data-act="pick" role="button" tabindex="0" aria-label="Choose files">
  <span class="drop-ico">${svg('upload')}</span>
  <span class="drop-text"><span class="drop-title"><span class="desk">${title}</span><span class="touch">${compact ? 'Add more files' : 'Choose files'}</span></span><span class="drop-sub">${sub}</span></span></div>`;

// ── start page ──────────────────────────────────────────────────────────────────────────────────────────
function card(t, match) {
  return `<a class="tool${match === true ? ' match' : match === false ? ' dim' : ''}" href="#${t.id}" style="${colours(t)}">
    <span class="tool-ico">${svg(t.glyph)}</span><span class="tool-name">${esc(t.title)}</span><span class="tool-text">${esc(t.text)}</span>${pair(t)}</a>`;
}
function renderHome() {
  const names = state.pending.map((f) => f.name), matches = names.length ? toolsFor(names) : null;
  const shown = TOOLS.filter((t) => matches || state.filter === 'all' || t.group === state.filter);
  const whole = matches ? matches.filter((id) => names.every((n) => fits(tool(id), n))).length : 0;
  const hint = !matches ? '' : !matches.length ? 'No tool here takes these files.' : !whole ? 'These files need different tools: pick one below, and it takes the files that fit it.'
    : `${whole === 1 ? 'One tool takes' : `${whole} tools take`} ${names.length === 1 ? 'this file' : 'these files'}: pick ${whole === 1 ? 'it' : 'one'} below.`;
  main.innerHTML = `<div class="page-head il-head"><h1>Every tool you need to convert your files</h1><p class="lead">PDF, Word, Excel, CSV, XML, pictures and text, converted right here in your browser. Nothing is uploaded.</p></div>
    ${dropZone('Drop files here, or <u>choose</u>', 'PDF, Word (.docx), Excel (.xlsx, .xls), CSV, XML, JPG, PNG, WEBP, text and Markdown')}
    ${names.length ? `<div class="pending card"><div class="pending-files">${state.pending.map((f) => `<span class="pending-file">${badge(f.name)}<span>${esc(f.name)}</span></span>`).join('')}</div>
      <p class="small">${hint}</p>${state.pending.filter((f) => !toolsFor([f.name]).length).map((f) => `<p class="small muted">${esc(unsupportedHint(f.name))}</p>`).join('')}
      <button type="button" class="btn small" data-act="clear-pending">Clear</button></div>` : ''}
    <div class="tools-head"><h2>${matches ? 'Tools for your files' : 'All tools'}</h2>${matches ? '' : `<div class="tabs" role="group" aria-label="Show tools">${GROUPS.map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('')}</div>`}</div>
    <div class="tools">${shown.map((t) => card(t, matches ? matches.includes(t.id) : null)).join('')}</div>
    <div id="results"></div>
    <p class="small muted how">How it works: the files are read by this page, in this browser, and never leave the device. The converters are served by this site the first time you use each tool; no other website or service is involved.</p>`;
  renderResults();
}

// ── a tool's page ───────────────────────────────────────────────────────────────────────────────────────
const seg = (name, label, choices, value) => `<fieldset class="seg"><legend>${label}</legend><div class="seg-row">${choices.map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}"${String(v) === String(value) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>`;
const check = (name, label, value) => `<label class="check"><input type="checkbox" name="${name}"${value ? ' checked' : ''}> ${label}</label>`;
const pick = (name, label, choices, value) => `<label class="field"><span>${label}</span><select name="${name}">${choices.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
const input = (name, label, value, placeholder, help = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false">${help ? `<small class="help" data-help="${name}">${help}</small>` : ''}</label>`;
const ORIENT = [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']];
const DELIM = [['auto', 'Find it'], [',', 'Comma ,'], [';', 'Semicolon ;'], ['\t', 'Tab'], ['|', 'Bar |']];
function options(t, o) {
  switch (t.id) {
    case 'csv-pdf': return seg('orientation', 'Page', ORIENT, o.orientation) + pick('delimiter', 'Separator', DELIM, o.delimiter) + check('header', 'First row is the header', o.header);
    case 'csv-excel': return pick('delimiter', 'Separator', DELIM, o.delimiter) + check('numbers', 'Make numbers real numbers', o.numbers);
    case 'excel-pdf': return seg('orientation', 'Page', ORIENT, o.orientation) + check('header', 'First row is the header', o.header);
    case 'excel-csv': return seg('sep', 'Separator', [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab']], o.sep);
    case 'pdf-img': return seg('dpi', 'Quality', [['150', 'Normal · 150 dpi'], ['300', 'Sharp · 300 dpi']], o.dpi) + input('pages', 'Pages (empty for all)', o.pages, 'e.g. 1-3, 5');
    case 'img-pdf': return seg('page', 'A4 page', ORIENT, o.page) + seg('margin', 'Margin', [['none', 'None'], ['small', 'Small'], ['big', 'Big']], o.margin);
    case 'split': return seg('mode', 'Split', [['every', 'Every page'], ['pages', 'Choose pages']], o.mode) + `<div class="split-pages"${o.mode === 'pages' ? '' : ' hidden'}>${input('pages', 'Pages', o.pages, 'e.g. 1-3, 5, 8-', pagesHelp())}${check('separate', 'Each range as its own PDF', o.separate)}</div>`;
    case 'pdf-excel': return seg('sheets', 'Sheets', [['one', 'All pages on one sheet'], ['page', 'One sheet per page']], o.sheets);
    case 'excel-xml': return check('header', 'First row has the column names', o.header);
    default: return '';
  }
}
const pagesHelp = () => { const n = state.files[0]?.pages; return n ? `This PDF has ${n} ${n === 1 ? 'page' : 'pages'}. “8-” means 8 to the end.` : '“8-” means page 8 to the end.'; };
const NOTES = {
  'pdf-word': 'The layout is simplified: the text comes across as paragraphs page by page, with headings guessed from the text size and bold and italic kept. Pictures, columns, tables and exact positions are not copied, and scans have no text to read.',
  'word-pdf': 'Fonts become Roboto, page margins are 2 cm, and headers, footers, text boxes and comments are left out.',
  'excel-pdf': 'Shows each cell’s value as Excel displays it; charts, pictures, colours and merged cells are left out. Hidden sheets are skipped.',
  'pdf-img': 'Big pages are drawn smaller so phones can handle them.',
  'pdf-excel': 'Works on tables that a computer made (bank statements, price lists, reports): the rows and columns are guessed from where the text sits. Scans and photos have no text to read, and tables without clear columns, merged cells or wrapped lines may come out wrong. Check the result.',
  'excel-xml': 'Each line becomes a <row>; the column names become the tags, cleaned so they are valid XML (letters, digits, _ and -). One file per sheet; hidden sheets are skipped.',
  'xml-excel': 'The repeated records become rows. Attributes become columns named @name, nested values become columns named parent/child. Deeply nested XML is flattened, and you are told when that happened.',
  'pdf-xml': 'Text only: <page n="1"><p>…</p></page> for every page. Tables, pictures and layout are not described, and scans have no text to read.',
  merge: 'Bookmarks and form fields are not kept. Password-protected PDFs need to be saved without the password first.',
};

function renderTool(t) {
  const o = state.opts[t.id] ||= { ...(DEFAULTS[t.id] || {}) };
  main.innerHTML = `<a class="back" href="#"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>All tools</a>
    <div class="tool-top" style="${colours(t)}"><span class="tool-ico big">${svg(t.glyph)}</span><div><p class="eyebrow">${esc(LABEL[t.from])} → ${esc(LABEL[t.to])}</p><h1>${esc(t.title)}</h1><p class="lead">${esc(t.text)}</p></div></div>
    <section class="card work" style="${colours(t)}">
      <div id="zone"></div>
      <ul class="files" id="files" aria-label="Files"></ul>
      ${options(t, o) ? `<form class="opts" id="opts" onsubmit="return false">${options(t, o)}</form>` : ''}
      ${NOTES[t.id] ? `<p class="note">${esc(NOTES[t.id])}</p>` : ''}
      <div class="errors" id="errors" role="alert"></div>
      <div class="go"><button type="button" class="btn go-btn" data-act="run">${esc(RUN_LABEL[t.id] || RUN_LABEL[t.to] || `Convert to ${LABEL[t.to]}`)}</button><button type="button" class="btn" data-act="clear-files" hidden>Start over</button><span class="progress" id="progress" aria-live="polite"></span></div>
    </section>
    <div id="results"></div>`;
  renderFiles(); renderResults();
}

function renderFiles() {
  const t = tool(state.view), list = $('#files');
  if (!t || !list) return;
  const many = t.order && state.files.length > 1, last = state.files.length - 1;
  $('#zone').innerHTML = dropZone(state.files.length ? (t.single ? 'Drop another PDF here, or <u>choose</u>' : 'Drop more files here, or <u>choose</u>') : `Drop ${t.single ? 'a PDF' : 'files'} here, or <u>choose</u>`, `${t.single ? 'One PDF at a time' : TAKES[t.from][0].toUpperCase() + TAKES[t.from].slice(1)}${many ? ' · drag ⠿ to change the order' : t.order ? ' · in the order you add them' : ''}`, state.files.length > 0);
  list.innerHTML = state.files.map((f, i) => `<li class="file" data-i="${i}">
    ${many ? `<button type="button" class="handle" aria-label="Drag to move ${esc(f.file.name)}" title="Drag to move">${svg('grip')}</button>` : ''}
    ${f.url ? `<img class="thumb" src="${f.url}" alt="" loading="lazy">` : badge(f.file.name)}
    <span class="file-main"><span class="file-name">${esc(f.file.name)}</span><span class="file-meta">${many ? `${i + 1} · ` : ''}${formatBytes(f.file.size)}${f.pages != null ? ` · ${f.pages} ${f.pages === 1 ? 'page' : 'pages'}` : ''}</span></span>
    ${many ? `<span class="file-move"><button type="button" class="icon-btn" data-move="${i}|-1" aria-label="Move ${esc(f.file.name)} up"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="icon-btn" data-move="${i}|1" aria-label="Move ${esc(f.file.name)} down"${i === last ? ' disabled' : ''}>↓</button></span>` : ''}
    <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove ${esc(f.file.name)}">×</button></li>`).join('');
  const help = document.querySelector('[data-help="pages"]');
  if (help && t.id === 'split') help.textContent = pagesHelp();
  document.querySelector('[data-act="clear-files"]').hidden = !state.files.length;
  setBusy(state.busy);
}

/** Adds files to the open tool; the ones it does not take are named with the reason. */
function addFiles(list) {
  const t = tool(state.view), files = [...list], ok = files.filter((f) => fits(t, f.name)), info = [];
  for (const f of files.filter((x) => !fits(t, x.name))) info.push(toolsFor([f.name]).length ? `${f.name} was left out: ${t.title} takes ${TAKES[t.from]}.` : unsupportedHint(f.name));
  const entry = (file) => ({ id: ++seq, file, url: t.from === 'img' ? URL.createObjectURL(file) : '', pages: null });
  if (t.single && ok.length) { if (ok.length > 1 || state.files.length) info.push(`${t.title} takes one PDF at a time: ${ok[ok.length - 1].name} is the one kept.`); dropFiles(); state.files = [entry(ok[ok.length - 1])]; }
  else state.files.push(...ok.map(entry));
  showErrors(info, false);
  renderFiles();
  if (t.id === 'merge' || t.id === 'split') for (const f of state.files.filter((x) => x.pages == null)) pageCount(f.file).then((n) => { f.pages = n; if (state.files.includes(f)) renderFiles(); });
}
function dropFiles(keep = []) { for (const f of state.files) if (f.url && !keep.includes(f)) URL.revokeObjectURL(f.url); state.files = keep; }

function showErrors(list, replace = true) {
  const box = $('#errors');
  if (!box) { if (list.length) toast(list[0]); return; }
  if (replace) box.innerHTML = '';
  box.insertAdjacentHTML('beforeend', list.map((m) => `<p${replace ? '' : ' class="info"'}>${esc(m)}</p>`).join(''));
}

function readOpts() {
  const form = $('#opts'), t = tool(state.view), o = state.opts[t.id] ||= { ...(DEFAULTS[t.id] || {}) };
  if (!form) return o;
  for (const el of form.elements) if (el.name) o[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'radio' ? (el.checked ? el.value : o[el.name]) : el.value;
  return o;
}

function setBusy(busy, text = '') {
  state.busy = busy; document.body.classList.toggle('busy', busy);
  const t = tool(state.view), btn = document.querySelector('[data-act="run"]');
  if (btn) {
    const label = RUN_LABEL[t.id] || RUN_LABEL[t.to] || `Convert to ${LABEL[t.to]}`;
    btn.disabled = busy || !state.files.length || (t.min && state.files.length < t.min);
    btn.innerHTML = busy ? `<span class="spin" aria-hidden="true"></span>Working…` : esc(label);
  }
  const p = $('#progress');
  if (p && (text || !busy)) p.textContent = busy ? text : state.files.length && t.min && state.files.length < t.min ? `Add at least ${t.min} PDFs.` : '';
}
const progress = (text) => { const p = $('#progress'); if (p) p.textContent = text; };

/** Asks for a PDF's password (pdf.js opens protected PDFs with it; it stays in this page). */
async function askPassword(name, wrong) {
  const v = await formDialog({ title: 'Password needed', note: wrong ? 'That password did not work. Try again.' : `${name} is protected with a password. It is used only here, to open the file.`, fields: [{ name: 'pw', label: 'Password', type: 'password', required: true, autocomplete: 'off' }], submit: 'Open' });
  return v ? v.pw : null;
}

async function run() {
  const t = tool(state.view);
  if (state.busy || !t) return;
  if (!state.files.length) return showErrors([`Add ${t.single ? 'a PDF' : 'files'} first.`]);
  if (t.min && state.files.length < t.min) return showErrors([`Add at least ${t.min} PDFs to merge.`]);
  const opts = readOpts(), runner = RUN[t.id], files = state.files.map((f) => f.file), made = [], errors = [];
  showErrors([]); setBusy(true, 'Starting…');
  const ctx = (prefix = '') => ({ progress: (s) => progress(prefix + s), password: askPassword });
  try {
    if (runner.all) {
      try { made.push(...await runner.all(files, opts, ctx())); } catch (e) { console.error(e); errors.push(friendlyError(e, files.length === 1 ? files[0].name : 'One of the files')); }
    } else {
      for (const [i, file] of files.entries()) {
        try { made.push(...await runner.each(file, opts, ctx(files.length > 1 ? `${i + 1} of ${files.length} · ` : ''))); } catch (e) { console.error(e); errors.push(friendlyError(e, file.name)); }
      }
    }
  } finally { setBusy(false); }
  addResults(made, t);
  showErrors(errors);
  if (made.length) toast(errors.length ? `${made.length} ready, ${errors.length} could not be converted.` : made.length === 1 ? `${made[0].name} is ready.` : `${made.length} files are ready.`);
  else if (errors.length) toast(errors.length === 1 ? 'That did not work: see the message above the button.' : 'Nothing could be converted: see the messages.');
}

// ── results ─────────────────────────────────────────────────────────────────────────────────────────────
function addResults(made, t) {
  if (!made.length) return;
  const taken = new Set(state.results.map((r) => r.name));
  for (const r of state.results) r.fresh = false;
  for (const r of made) { r.name = uniqueName(r.name, taken); taken.add(r.name); Object.assign(r, { id: ++seq, url: URL.createObjectURL(r.blob), tool: t.title, fresh: true }); }
  state.results.unshift(...made);
  renderResults();
  $('#results')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
/** The first rows of a converted table, folded away under the file (numbers right-aligned). */
function previewOf(rows) {
  if (!rows || !rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length)), num = (v) => typeof v === 'number' || /^-?(\d{1,3}([.,]\d{3})+|\d+)([.,]\d+)?$/.test(String(v));
  return `<details class="preview"><summary>Preview: first ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}</summary><div class="tw"><table><tbody>${rows.map((r) => `<tr>${Array.from({ length: width }, (_, c) => `<td${num(r[c] ?? '') && r[c] !== '' ? ' class="num"' : ''}>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function renderResults() {
  const box = $('#results');
  if (!box) return;
  const n = state.results.length;
  box.innerHTML = n ? `<section class="card results"><div class="card-head"><div><p class="eyebrow">${n} ${n === 1 ? 'file' : 'files'} ready</p><h2>Your files</h2></div><div class="results-actions">${n > 1 ? '<button type="button" class="btn primary small" data-act="all">Download all</button>' : ''}<button type="button" class="btn small" data-act="clear-results">Clear</button></div></div>
    <ul class="list">${state.results.map((r) => `<li class="item result${r.fresh ? ' fresh' : ''}">${badge(r.name)}<span class="item-main"><span class="item-title">${esc(r.name)}</span><span class="item-meta">${formatBytes(r.blob.size)} · ${esc(r.tool)}${r.note ? ` · ${esc(r.note)}` : ''}</span></span>
      <span class="item-side">${canShare ? `<button type="button" class="btn small" data-share="${r.id}">Share</button>` : ''}<a class="btn small primary" href="${r.url}" download="${esc(r.name)}">Download</a></span>${r.warn ? `<p class="warnline">${esc(r.note)}</p>` : ''}${previewOf(r.preview)}</li>`).join('')}</ul>
    <p class="small muted">The files live in this tab only: download them before you close or reload it.</p></section>` : '';
}
function save(name, blob) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function downloadAll(btn) {
  btn.disabled = true; btn.textContent = 'Zipping…';
  try { const z = await zipOf(state.results, 'Converted files.zip'); save(z.name, z.blob); } catch (e) { console.error(e); toast(friendlyError(e, 'The ZIP')); } finally { btn.disabled = false; btn.textContent = 'Download all'; }
}
async function share(id) {
  const r = state.results.find((x) => x.id === id);
  if (!r) return;
  try { await navigator.share({ files: [new File([r.blob], r.name, { type: r.blob.type })], title: r.name }); } catch (e) { if (e && e.name !== 'AbortError') toast('Sharing did not work here: use Download instead.'); }
}

// ── files in: drop, choose ──────────────────────────────────────────────────────────────────────────────
function take(fileList) {
  const files = [...fileList].filter((f) => f && f.name);
  if (!files.length) return;
  if (state.busy) return toast('Wait until the conversion is done.');
  if (state.view) return addFiles(files);
  state.pending = files;
  const names = files.map((f) => f.name), fit = toolsFor(names);
  if (!fit.length) { renderHome(); return; } // the box under the drop zone says why for each file
  if (fit.length === 1 && names.every((n) => fits(tool(fit[0]), n))) { location.hash = fit[0]; return; } // a .docx: straight to Word to PDF
  renderHome();
  document.querySelector('.tools-head')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// one hidden file input in the page (iPhone Safari opens the picker more reliably for an input that is in the page)
const picker = Object.assign(document.createElement('input'), { type: 'file', hidden: true });
picker.addEventListener('change', () => { const files = [...picker.files]; picker.value = ''; take(files); }); // cleared, so the same file can be chosen again
document.body.appendChild(picker);
function choose() {
  if (state.busy) return;
  const t = tool(state.view);
  picker.multiple = !t || !t.single;
  picker.accept = t ? t.accept.map((e) => '.' + e).concat(MIMES[t.from] || []).join(',') : ALL_ACCEPT;
  picker.click();
}

// drag-and-drop anywhere on the page (and never let the browser open a dropped file instead)
let depth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = state.busy ? 'none' : 'copy'; });
window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; document.body.classList.remove('dragging'); take(e.dataTransfer.files); });

// reorder by dragging the handle (pointer events: mouse, finger and pen alike); the arrows do the same from the keyboard
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle || state.busy || e.button > 0) return;
  const list = $('#files'), row = handle.closest('.file'), rows = [...list.children], from = rows.indexOf(row);
  const rects = rows.map((r) => r.getBoundingClientRect()), step = rows.length > 1 ? rects[1].top - rects[0].top : rects[0].height, y0 = e.clientY;
  let to = from;
  e.preventDefault(); try { handle.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
  list.classList.add('sorting'); row.classList.add('dragging');
  const move = (ev) => {
    const dy = Math.max(rects[0].top - rects[from].top - 8, Math.min(rects[rects.length - 1].top - rects[from].top + 8, ev.clientY - y0));
    row.style.transform = `translateY(${dy}px)`;
    const centre = rects[from].top + rects[from].height / 2 + dy;
    to = rows.filter((r, i) => i !== from && rects[i].top + rects[i].height / 2 < centre).length;
    rows.forEach((r, i) => { if (i === from) return; const shift = from < to && i > from && i <= to ? -step : from > to && i < from && i >= to ? step : 0; r.style.transform = shift ? `translateY(${shift}px)` : ''; });
  };
  const end = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
    list.classList.remove('sorting'); rows.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
    if (to !== from) { const [f] = state.files.splice(from, 1); state.files.splice(to, 0, f); renderFiles(); }
  };
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act],[data-filter],[data-remove],[data-move],[data-share]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'pick') choose();
  else if (act === 'run') run();
  else if (act === 'all') downloadAll(el);
  else if (act === 'clear-pending') { state.pending = []; renderHome(); }
  else if (act === 'clear-files') { if (!state.busy) { dropFiles(); showErrors([]); renderFiles(); } }
  else if (act === 'clear-results') { for (const r of state.results) URL.revokeObjectURL(r.url); state.results = []; renderResults(); }
  else if (el.dataset.filter) { state.filter = el.dataset.filter; renderHome(); }
  else if (el.dataset.remove != null && !state.busy) { const [f] = state.files.splice(+el.dataset.remove, 1); if (f?.url) URL.revokeObjectURL(f.url); renderFiles(); }
  else if (el.dataset.move && !state.busy) { const [i, d] = el.dataset.move.split('|').map(Number), j = i + d; if (j >= 0 && j < state.files.length) { [state.files[i], state.files[j]] = [state.files[j], state.files[i]]; renderFiles(); document.querySelector(`[data-move="${j}|${d}"]`)?.focus(); } }
  else if (el.dataset.share) share(+el.dataset.share);
});
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.drop')) { e.preventDefault(); choose(); } });
document.addEventListener('change', (e) => {
  if (!e.target.closest('#opts')) return;
  const o = readOpts();
  const box = document.querySelector('.split-pages');
  if (box) box.hidden = o.mode !== 'pages';
});
window.addEventListener('beforeunload', (e) => { if (state.busy) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); if (state.busy) toast(friendlyError(e.reason, 'Convert')); });

// ── pages: #<tool id> is a tool, anything else the start page ─────────────────────────────────────────
function route() {
  const t = tool(decodeURIComponent(location.hash.slice(1)));
  if (t) {
    if (state.view !== t.id) { dropFiles(); state.view = t.id; renderTool(t); if (state.pending.length) { const p = state.pending; state.pending = []; addFiles(p); } }
  } else {
    if (state.view && state.files.length) state.pending = state.files.map((f) => f.file); // back to the tools with the same files
    dropFiles(); state.view = null; renderHome();
  }
  document.title = `${t ? t.title + ' · ' : ''}Convert — Business Apps`;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
