// Invoice to eSLOG XML: the page. A vertical stepper in five steps (drop the file, check the field mapping, preview,
// validate, download). All the thinking is in the pure modules next to this file (extract, model, validate, eslog); this
// file only draws it and wires the controls. Nothing is uploaded: the file is read in the page.
//   mountEslog(root, deps) → { load(file), destroy() }
//   deps: { esc, toast, dropZone(title, sub, compact), badge(name), formatBytes, read(file) → {kind, grids, note}, busy(bool) }
import {
  buildInvoice, cellChoices, columnChoices, extract, mappingOf, pickGrid, valueAt,
} from './extract.mjs';
import { buildEslog, eslogFileName } from './eslog.mjs';
import { computeTotals, isNum, parseNumber, parseVatRate, showDate, showIban, showMoney, showPrice, showQty, showRate, SI_VAT_RATES } from './model.mjs';
import { canDownload, passedChecks, summary, validate } from './validate.mjs';

const MAIN = [['number', 'Invoice number'], ['issueDate', 'Issue date'], ['dueDate', 'Due date'], ['currency', 'Currency'], ['seller.name', 'Seller name'], ['seller.vatId', 'Seller VAT ID'], ['buyer.name', 'Buyer name'], ['buyer.vatId', 'Buyer VAT ID']];
const MORE = [['paymentReference', 'Payment reference'], ['seller.iban', 'Seller IBAN'], ['seller.street', 'Seller street'], ['seller.postalCode', 'Seller postal code'], ['seller.city', 'Seller city'], ['seller.contact', 'Seller contact'],
  ['buyer.street', 'Buyer street'], ['buyer.postalCode', 'Buyer postal code'], ['buyer.city', 'Buyer city'], ['totalNet', 'Total without VAT (checked against the lines)'], ['totalGross', 'Total to pay (checked against the lines)']];
const COLS = [['description', 'Description'], ['quantity', 'Quantity'], ['unit', 'Unit'], ['unitPrice', 'Unit price'], ['vatRate', 'VAT rate'], ['net', 'Line amount']];
const PARTY_BOXES = [['name', 'Name', 'organization'], ['vatId', 'VAT ID', 'off'], ['iban', 'IBAN', 'off'], ['street', 'Street', 'off'], ['postalCode', 'Postal code', 'off'], ['city', 'City', 'off'], ['country', 'Country', 'off']];
const STEPS = [['1', 'Drop the file'], ['2', 'Check the field mapping'], ['3', 'Preview the invoice'], ['4', 'Validate'], ['5', 'Download XML']];
const CHECKMARK = '✓';
const SAMPLE_LINES = 44;

export function mountEslog(root, deps) {
  const { esc } = deps;
  const S = { file: null, read: null, sheet: 0, grid: null, analysis: null, mapping: null, parties: { seller: {}, buyer: {} }, edits: {}, inv: null, issues: [], xml: '', error: '', loading: '' };
  let blobUrl = '';

  // ── skeleton ────────────────────────────────────────────────────────────────────────────────────────────
  root.innerHTML = `<ol class="es-steps" id="es">${STEPS.map(([n, title]) => `<li class="es-step todo" id="es-s${n}">
      <div class="es-rail"><span class="es-dot" aria-hidden="true">${n}</span><span class="es-line" aria-hidden="true"></span></div>
      <section class="card es-card" aria-labelledby="es-h${n}"><h2 id="es-h${n}" tabindex="-1"><span class="es-stepno">Step ${n}.</span> ${esc(title)}</h2><div class="es-sub muted small" id="es-sub${n}"></div><div class="es-body" id="es-b${n}"></div></section></li>`).join('')}</ol>`;
  const $ = (sel) => root.querySelector(sel);
  const body = (n) => $(`#es-b${n}`);
  const sub = (n, t) => { $(`#es-sub${n}`).textContent = t; };
  const setStep = (n, state, mark) => { const li = $(`#es-s${n}`); li.className = `es-step ${state}`; $(`#es-s${n} .es-dot`).textContent = state === 'done' ? CHECKMARK : mark || n; li.querySelector('.es-card').toggleAttribute('data-done', state === 'done'); };

  // ── step 1: the file ────────────────────────────────────────────────────────────────────────────────────
  function renderFile() {
    const f = S.file, loaded = Boolean(S.grid);
    const info = f && loaded ? `${deps.formatBytes(f.size)}${S.read.kind === 'xlsx' ? ` · sheet “${esc(S.read.grids[S.sheet].name)}”` : ' · PDF with a text layer'} · ${S.inv ? `${S.inv.lines.length} ${S.inv.lines.length === 1 ? 'line' : 'lines'} found` : ''}` : '';
    body(1).innerHTML = `${deps.dropZone('Drop an Excel or PDF invoice here, or <u>choose</u>', '.xlsx, .xls or .pdf with a text layer. Nothing is uploaded: it is read on this device.', loaded)}
      ${S.loading ? `<p class="es-load" role="status"><span class="spin dark" aria-hidden="true"></span>${esc(S.loading)}</p>` : ''}
      ${S.error ? `<div class="errors" role="alert"><p>${esc(S.error)}</p></div>` : ''}
      ${loaded ? `<div class="es-file">${deps.badge(f.name)}<span class="es-file-main"><b>${esc(f.name)}</b><span class="muted small">${info}</span></span><span class="es-chip ok">Read</span>
        ${S.read.grids.length > 1 ? `<label class="es-sheetpick"><span class="small muted">Sheet</span><select data-sheet aria-label="Sheet to read">${S.read.grids.map((g, i) => `<option value="${i}"${i === S.sheet ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>` : ''}</div>
        ${S.read.note ? `<p class="small muted">${esc(S.read.note)}</p>` : ''}` : ''}`;
    sub(1, loaded ? 'Excel or PDF' : 'Excel (.xlsx, .xls) or a PDF made by a computer. Scans are not supported.');
  }

  // ── step 2: mapping ─────────────────────────────────────────────────────────────────────────────────────
  const pct = (x) => Math.round(x * 100);
  const barClass = (p) => (p >= 80 ? '' : p >= 50 ? 'mid' : 'low');
  function confOf(key) {
    const ref = S.mapping.fields[key], det = S.analysis.fields[key];
    if (!ref) return { p: 0, you: false };
    if (det && det.ref === ref) return { p: pct(det.confidence), you: false };
    return { p: 100, you: true };
  }
  const confHtml = (c) => `<span class="es-conf"><span class="es-bar ${barClass(c.p)}" aria-hidden="true"><i style="width:${c.p}%"></i></span><span>${c.you ? 'Your pick' : `${c.p}%`}</span></span>`;
  function fieldRow(key, label) {
    const ref = S.mapping.fields[key], c = confOf(key), cur = ref ? valueAt(S.grid, ref) : '';
    const choices = S.choices.slice(), has = ref && choices.some((x) => x.ref === ref);
    if (ref && !has) choices.unshift({ ref, text: cur });
    const bad = !ref;
    return `<div class="es-maprow" data-row="${esc(key)}"><label class="es-maplabel" for="es-map-${esc(key)}"><b>${esc(label)}</b></label>
      <span class="es-confcell" data-conf>${confHtml(c)}</span><span class="es-samp" data-samp title="${esc(cur)}">${ref ? esc(cur) : 'no matching cell'}</span>
      <select id="es-map-${esc(key)}" class="es-sel${bad ? ' err' : ''}" data-map="${esc(key)}"><option value="">Not found</option>${choices.map((x) => `<option value="${esc(x.ref)}"${x.ref === ref ? ' selected' : ''}>${esc(x.ref.replace('#', ' · '))} · ${esc(x.text)}</option>`).join('')}</select></div>`;
  }
  function colRow(key, label) {
    const cur = S.mapping.columns[key], det = S.analysis.table?.columns[key];
    const c = cur == null ? { p: 0, you: false } : det && det.col === cur ? { p: pct(det.confidence), you: false } : { p: 100, you: true };
    const t = S.mapping.table, row = S.grid[t.firstRow] || [];
    const sample = cur == null ? '' : String(row[cur] ?? '');
    return `<div class="es-maprow" data-row="col-${key}"><label class="es-maplabel" for="es-col-${key}"><b>${label}</b></label><span class="es-confcell" data-conf>${confHtml(c)}</span><span class="es-samp" data-samp title="${esc(sample)}">${cur == null ? (key === 'quantity' ? 'not in the file: 1 is used' : 'not in the file') : esc(sample)}</span>
      <select id="es-col-${key}" class="es-sel${cur == null && key !== 'unit' && key !== 'quantity' ? ' err' : ''}" data-col="${key}"><option value="">Not in the file</option>${S.colChoices.map((x) => `<option value="${x.col}"${x.col === cur ? ' selected' : ''}>${x.letter} · ${esc(x.title)}</option>`).join('')}</select></div>`;
  }
  function partyBox(side, title) {
    const p = S.inv[side];
    return `<fieldset class="es-party" data-party-box="${side}"><legend>${title}</legend>${PARTY_BOXES.filter(([k]) => !(side === 'buyer' && k === 'iban')).map(([k, label, ac]) =>
      `<label class="es-pf"><span>${label}</span><input data-f="${side}.${k}" data-side="${side}" data-key="${k}" value="${esc(k === 'iban' ? showIban(p[k]) : p[k])}" autocomplete="${ac}" autocapitalize="off" spellcheck="false"></label>`).join('')}</fieldset>`;
  }
  function renderMapping() {
    const found = [...MAIN].filter(([k]) => S.mapping.fields[k]).length, t = S.mapping.table;
    sub(2, `${found} of ${MAIN.length} header fields and ${COLS.filter(([k]) => S.mapping.columns[k] != null).length} of ${COLS.length} line columns found. Change any that look wrong.`);
    const more = MORE.filter(([k]) => S.mapping.fields[k]).length;
    body(2).innerHTML = `<div class="es-maps">${MAIN.map(([k, l]) => fieldRow(k, l)).join('')}</div>
      <details class="es-more"><summary>More fields (${more} of ${MORE.length} found)</summary><div class="es-maps">${MORE.map(([k, l]) => fieldRow(k, l)).join('')}</div></details>
      <p class="eyebrow es-lineshead">Invoice lines${t.headerRow >= 0 ? ` · titles in row ${t.headerRow + 1}` : ''}</p>
      <div class="es-maps">${COLS.map(([k, l]) => colRow(k, l)).join('')}</div>
      <div class="es-rows"><label class="es-pf"><span>First line row</span><input type="number" min="1" inputmode="numeric" data-tr="firstRow" value="${t.firstRow + 1}"></label><label class="es-pf"><span>Last line row</span><input type="number" min="1" inputmode="numeric" data-tr="lastRow" value="${t.lastRow + 1}"></label></div>
      <p class="eyebrow es-lineshead">Seller and buyer</p><p class="small muted">Filled in from the file. Type over anything that is wrong or missing.</p>
      <div class="es-cols2">${partyBox('seller', 'Seller')}${partyBox('buyer', 'Buyer')}</div>`;
    const ok = MAIN.every(([k]) => S.mapping.fields[k]) && COLS.slice(0, 1).concat(COLS.slice(2, 3), COLS.slice(3, 5)).every(([k]) => S.mapping.columns[k] != null || k === 'unit');
    setStep(2, ok ? 'done' : 'cur', '2');
  }

  // ── step 3: preview ─────────────────────────────────────────────────────────────────────────────────────
  function vatSelect(i, l) {
    const opts = [...SI_VAT_RATES]; if (isNum(l.vatRate) && !opts.includes(l.vatRate)) opts.push(l.vatRate);
    return `<select class="es-in" data-f="line.${i + 1}.vatRate" data-line="${i}" data-lk="vatRate" aria-label="VAT rate, line ${i + 1}">${isNum(l.vatRate) ? '' : '<option value="" selected>?</option>'}${opts.map((r) => `<option value="${r}"${r === l.vatRate ? ' selected' : ''}>${showRate(r)}</option>`).join('')}</select>`;
  }
  function renderLines() {
    const inv = S.inv;
    $('#es-lines').innerHTML = inv.lines.length ? `<div class="es-lhead" aria-hidden="true"><span>#</span><span>Description</span><span class="num">Qty</span><span class="num">Unit price</span><span class="num">VAT</span><span class="num">Net</span></div>${inv.lines.map((l, i) => `<div class="es-line-row" role="group" aria-label="Line ${i + 1}">
      <span class="es-ln">${i + 1}</span>
      <label class="es-lc es-desc"><span class="es-lab">Description</span><input class="es-in" data-f="line.${i + 1}.description" data-line="${i}" data-lk="description" value="${esc(l.description)}" autocomplete="off"></label>
      <label class="es-lc"><span class="es-lab">Qty</span><input class="es-in num" inputmode="decimal" data-f="line.${i + 1}.quantity" data-line="${i}" data-lk="quantity" value="${esc(showQty(l.quantity))}" autocomplete="off"></label>
      <label class="es-lc"><span class="es-lab">Unit price</span><input class="es-in num" inputmode="decimal" data-f="line.${i + 1}.unitPrice" data-line="${i}" data-lk="unitPrice" value="${esc(showPrice(l.unitPrice))}" autocomplete="off"></label>
      <label class="es-lc"><span class="es-lab">VAT</span>${vatSelect(i, l)}</label>
      <span class="es-lc es-net"><span class="es-lab">Net</span><span class="num" data-net="${i}"></span></span></div>`).join('')}` : '<p class="muted small">No lines were found. Check the line columns in step 2.</p>';
    updateNets();
  }
  function updateNets() {
    const t = computeTotals(S.inv);
    root.querySelectorAll('[data-net]').forEach((e) => { const n = t.lines[+e.dataset.net]?.net; e.textContent = n == null ? '?' : showMoney(n); });
  }
  function renderPreviewHead() {
    const inv = S.inv, s = inv.seller, b = inv.buyer, miss = (v) => v ? esc(v) : '<span class="es-miss">missing</span>';
    $('#es-phead').innerHTML = `<div><div class="eyebrow">Invoice</div><h3 class="es-invno">${miss(inv.number)}</h3><div class="muted small">Issued ${inv.issueDate ? esc(showDate(inv.issueDate)) : '<span class="es-miss">missing</span>'} · due ${inv.dueDate ? esc(showDate(inv.dueDate)) : 'not given'} · ${esc(inv.currency || '?')}</div></div>
      <div class="small es-seller"><b>${miss(s.name)}</b><br>${miss(s.vatId)}${s.iban ? `<br><span class="mono">${esc(showIban(s.iban))}</span>` : ''}</div>`;
    $('#es-bill').innerHTML = `Bill to: <b>${miss(b.name)}</b> · VAT ID ${b.vatId ? esc(b.vatId) : '<span class="es-miss">missing</span>'}`;
  }
  function renderTotals() {
    const t = computeTotals(S.inv), cur = S.inv.currency === 'EUR' || !S.inv.currency ? '€' : S.inv.currency;
    $('#es-totals').innerHTML = `<div><span class="muted">Net total</span><span>${showMoney(t.net)} ${esc(cur)}</span></div>${t.rates.map((r) => `<div><span class="muted">VAT ${esc(showRate(r.rate))}</span><span>${showMoney(r.vat)} ${esc(cur)}</span></div>`).join('')}<div class="g"><span>Total to pay</span><span>${showMoney(t.gross)} ${esc(cur)}</span></div>`;
  }
  function renderPreview() {
    body(3).innerHTML = `<div class="card es-inv"><div class="es-inv-h" id="es-phead"></div><p class="small muted es-bill" id="es-bill"></p><div class="es-lines" id="es-lines"></div><div class="es-tot" id="es-totals" tabindex="-1" aria-label="Totals"></div></div>
      <p class="small muted">Quantity, unit price, VAT rate and description can be changed here. The totals are calculated from the lines.</p>`;
    sub(3, 'This is how the parsed data reads.');
    renderLines(); renderPreviewHead(); renderTotals();
    setStep(3, 'done');
  }

  // ── step 4: validate ────────────────────────────────────────────────────────────────────────────────────
  function renderChecks() {
    const issues = S.issues, passed = passedChecks(S.inv, issues), sm = summary(issues);
    sub(4, `${sm.errors} ${sm.errors === 1 ? 'error' : 'errors'}, ${sm.warnings} ${sm.warnings === 1 ? 'warning' : 'warnings'}, ${passed.length} passed`);
    const row = (cls, mark, i) => `<li class="${cls}"><span class="es-st" aria-hidden="true">${mark}</span><b>${esc(i.message)}</b>${i.field ? `<button type="button" class="btn small es-fix" data-fix="${esc(i.field)}">${esc(i.fix)}</button>` : ''}${i.detail ? `<p>${esc(i.detail)}</p>` : ''}</li>`;
    const ok = (i) => `<li><span class="es-st" aria-hidden="true">${CHECKMARK}</span><b>${esc(i.message)}</b><p>${esc(i.detail)}</p></li>`;
    body(4).innerHTML = `<ul class="es-chk">${issues.filter((i) => i.level === 'error').map((i) => row('bad', '!', i)).join('')}${issues.filter((i) => i.level === 'warning').map((i) => row('warn', '?', i)).join('')}${passed.map(ok).join('')}</ul>
      <p class="small muted es-honest">This is our own rule check, not a check against the official eSLOG schema. UJP's structure check (<span class="mono">storitve.ujp.gov.si</span>) is the final word.</p>`;
    setStep(4, sm.errors ? 'bad' : 'done', '!');
  }

  // ── step 5: download ────────────────────────────────────────────────────────────────────────────────────
  const hl = (xml) => esc(xml).replace(/(&lt;\/?)([A-Za-z_][\w]*)((?:\s[^&]*?)?)(\/?&gt;)/g, (m, a, name, attrs, z) => `<span class="t">${a}${name}</span>${attrs.replace(/&quot;(.*?)&quot;/g, '&quot;<span class="v">$1</span>&quot;')}<span class="t">${z}</span>`);
  function renderDownload() {
    const ok = canDownload(S.issues), sm = summary(S.issues);
    S.xml = buildEslog(S.inv);
    const lines = S.xml.split('\n'), shown = lines.slice(0, SAMPLE_LINES);
    sub(5, `eSLOG 2.0 · UTF-8 · ${(new Blob([S.xml]).size / 1024).toFixed(1).replace('.', ',')} KB`);
    body(5).innerHTML = `<div class="es-dl"><button type="button" class="btn primary" data-act-es="download"${ok ? '' : ' disabled aria-disabled="true"'}>Download eSLOG XML</button><button type="button" class="btn" data-act-es="copy"${ok ? '' : ' disabled'}>Copy XML</button>
      <span class="small muted" id="es-dl-note">${ok ? (sm.warnings ? `${sm.warnings} ${sm.warnings === 1 ? 'warning does' : 'warnings do'} not block the download.` : 'No problems found.') : `Fix the ${sm.errors} ${sm.errors === 1 ? 'error' : 'errors'} first. Warnings do not block the download.`}</span></div>
      <p class="small muted">File name: <span class="mono">${esc(eslogFileName(S.inv))}</span>. The element mapping is written from knowledge of eSLOG 2.0 and has not been compared with the official documentation, so run the file through UJP's structure check before you send it.</p>
      <pre class="es-xml" tabindex="0" aria-label="Start of the XML">${hl(shown.join('\n'))}${lines.length > shown.length ? `\n<span class="c">… ${lines.length - shown.length} more lines</span>` : ''}</pre>`;
    setStep(5, ok ? 'cur' : 'todo');
  }

  // ── the pipeline ────────────────────────────────────────────────────────────────────────────────────────
  function rebuild() {
    const inv = buildInvoice(S.grid, S.mapping, S.parties);
    for (const [i, e] of Object.entries(S.edits)) { if (inv.lines[i]) Object.assign(inv.lines[i], e); }
    S.inv = inv; S.issues = validate(inv);
  }
  /** After an edit that does not change the lines table or the mapping boxes. */
  function refresh() { rebuild(); updateNets(); renderPreviewHead(); renderTotals(); renderChecks(); renderDownload(); }
  function lockSteps(message) {
    for (const n of [2, 3, 4, 5]) { body(n).innerHTML = `<p class="muted small">${esc(message)}</p>`; sub(n, ''); setStep(n, 'todo'); }
    setStep(1, 'cur', '1');
  }
  function analyse() {
    S.grid = S.read.grids[S.sheet].grid;
    S.analysis = extract(S.grid);
    S.mapping = mappingOf(S.analysis);
    S.choices = cellChoices(S.grid, S.analysis.table, 300);
    S.colChoices = columnChoices(S.grid, S.analysis.table);
    S.parties = { seller: {}, buyer: {} }; S.edits = {};
    rebuild();
    renderFile(); renderMapping(); renderPreview(); renderChecks(); renderDownload();
    setStep(1, 'done');
  }
  async function load(file) {
    S.error = ''; S.loading = `Reading ${file.name}…`;
    if (!S.grid) lockSteps('Available after you drop a file.');
    renderFile(); deps.busy(true);
    try {
      const read = await deps.read(file, { progress: (t) => { S.loading = t; const e = root.querySelector('.es-load'); if (e) e.lastChild.textContent = t; }, password: deps.password });
      S.read = read; S.file = file;
      S.sheet = read.kind === 'xlsx' ? pickGrid(read.grids).index : 0;
      S.loading = ''; analyse();
      $('#es-h2').focus({ preventScroll: true }); $('#es-s2').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      S.loading = ''; S.error = deps.friendly(e, file.name);
      if (!S.grid) lockSteps('Available after you drop a file.');
      renderFile();
    } finally { deps.busy(false); }
  }

  // ── events ──────────────────────────────────────────────────────────────────────────────────────────────
  function onPartyInput(el) {
    const { side, key } = el.dataset;
    S.parties[side][key] = el.value;
    refresh();
  }
  function remapRow(row, kind, key) {
    const conf = row.querySelector('[data-conf]'), samp = row.querySelector('[data-samp]');
    let c, cur;
    if (kind === 'map') { c = confOf(key); const ref = S.mapping.fields[key]; cur = ref ? valueAt(S.grid, ref) : ''; samp.textContent = ref ? cur : 'no matching cell'; }
    else { const col = S.mapping.columns[key], det = S.analysis.table?.columns[key]; c = col == null ? { p: 0, you: false } : det && det.col === col ? { p: pct(det.confidence), you: false } : { p: 100, you: true }; cur = col == null ? '' : String((S.grid[S.mapping.table.firstRow] || [])[col] ?? ''); samp.textContent = col == null ? 'not in the file' : cur; }
    samp.title = cur; conf.innerHTML = confHtml(c);
    row.querySelector('select').classList.toggle('err', kind === 'map' ? !S.mapping.fields[key] : S.mapping.columns[key] == null && key !== 'unit' && key !== 'quantity');
  }
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-sheet]')) { S.sheet = +t.value; analyse(); return; }
    if (t.matches('[data-map]')) {
      const key = t.dataset.map; S.mapping.fields[key] = t.value || null;
      const m = /^(seller|buyer)\.(.+)$/.exec(key);
      if (m) delete S.parties[m[1]][m[2]];
      rebuild();
      if (m) { const inp = root.querySelector(`[data-f="${key}"]`); if (inp) inp.value = m[2] === 'iban' ? showIban(S.inv[m[1]][m[2]]) : S.inv[m[1]][m[2]]; }
      remapRow(t.closest('.es-maprow'), 'map', key);
      renderPreviewHead(); renderTotals(); renderChecks(); renderDownload(); updateNets();
      return;
    }
    if (t.matches('[data-col]')) {
      S.mapping.columns[t.dataset.col] = t.value === '' ? null : +t.value; S.edits = {};
      rebuild(); remapRow(t.closest('.es-maprow'), 'col', t.dataset.col);
      renderPreview(); renderChecks(); renderDownload(); renderFile();
      return;
    }
    if (t.matches('[data-tr]')) {
      const v = Math.max(1, Math.floor(+t.value || 1)) - 1; S.mapping.table[t.dataset.tr] = v; S.edits = {};
      rebuild(); renderPreview(); renderChecks(); renderDownload(); renderFile(); return;
    }
    if (t.matches('[data-lk]')) {
      const i = +t.dataset.line, k = t.dataset.lk, e2 = (S.edits[i] ||= {});
      if (k === 'description') e2.description = t.value.trim();
      else if (k === 'vatRate') e2.vatRate = t.value === '' ? null : parseVatRate(t.value);
      else { e2[k] = parseNumber(t.value); e2.net = null; if (e2[k] != null) t.value = k === 'quantity' ? showQty(e2[k]) : showPrice(e2[k]); }
      refresh();
    }
  });
  root.addEventListener('input', (e) => { if (e.target.matches('[data-side]')) onPartyInput(e.target); });
  root.addEventListener('click', (e) => {
    const fix = e.target.closest('[data-fix]'), act = e.target.closest('[data-act-es]');
    if (fix) return jumpTo(fix.dataset.fix);
    if (!act || act.disabled) return;
    if (act.dataset.actEs === 'download') download();
    else if (act.dataset.actEs === 'copy') copy();
  });
  function jumpTo(field) {
    let target = null;
    if (/^(seller|buyer|line\.)/.test(field)) target = root.querySelector(`[data-f="${field}"]`);
    else if (field === 'lines') target = root.querySelector('[data-col="description"]');
    else if (field === 'totals') target = $('#es-totals');
    else target = root.querySelector(`[data-map="${field}"]`);
    if (!target) return;
    target.closest('details')?.setAttribute('open', '');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
    const host = target.closest('.es-maprow, .es-pf, .es-line-row') || target;
    host.classList.add('es-flash'); setTimeout(() => host.classList.remove('es-flash'), 1800);
  }
  function download() {
    if (!canDownload(S.issues)) return;
    const blob = new Blob([S.xml], { type: 'application/xml;charset=utf-8' }), a = document.createElement('a');
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob); a.href = blobUrl; a.download = eslogFileName(S.inv); document.body.appendChild(a); a.click(); a.remove();
    deps.toast(`${a.download} is ready. Check it with UJP's structure check before sending.`);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(S.xml); deps.toast('The XML is copied.'); } catch { deps.toast('Copying did not work here: use Download instead.'); }
  }

  lockSteps('Available after you drop a file.');
  renderFile();
  return {
    load,
    destroy() { if (blobUrl) URL.revokeObjectURL(blobUrl); root.innerHTML = ''; },
    /** For tests and screenshots: the state of the page. */
    get state() { return S; },
  };
}
