/* Billing: bank statement import. Pure rules, no DOM; loaded by index.html and by the Node tests.
 *
 * Reads an ISO 20022 camt.053 statement (BkToCstmrStmt, versions .001.02 to .001.13: the element names used here are
 * the same in all of them; v08+ moves the debtor name to Dbtr/Pty/Nm and the status to Sts/Cd, both handled) or a
 * bank's CSV export, and matches each incoming payment (CRDT) to an issued invoice:
 *   1. by the payment reference (model SI00, as printed on the invoice and in its UPN QR: "SI00 2026-0001"),
 *   2. by the invoice number written in the payment purpose,
 *   3. by the open amount, together with the payer's name matching the client,
 *   4. by the open amount alone (only suggested, never ticked).
 * Nothing is recorded here: the app records the ticked rows as ordinary payments (with the audit log).
 */
(function (root) {
  'use strict';
  const C = root.BillingCore || (typeof require === 'function' ? require('./core.js') : null);

  // ---------- a small XML reader (elements, attributes, text, CDATA; namespace prefixes dropped) ----------
  const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e] ?? m;
  });
  const local = (n) => n.slice(n.indexOf(':') + 1);
  function parseXml(text) {
    const src = String(text).replace(/^﻿/, '');
    const rootNode = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [rootNode];
    let i = 0;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      const top = stack[stack.length - 1];
      if (lt < 0) { top.text += decode(src.slice(i)); break; }
      if (lt > i) top.text += decode(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); if (e < 0) throw new Error('Unclosed comment'); i = e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); if (e < 0) throw new Error('Unclosed CDATA'); top.text += src.slice(lt + 9, e); i = e + 3; continue; }
      if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); if (e < 0) throw new Error('Unclosed declaration'); i = e + 2; continue; }
      if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt + 2); if (e < 0) throw new Error('Unclosed declaration'); i = e + 1; continue; }
      // find the end of the tag, skipping quoted attribute values
      let j = lt + 1, q = null;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
      }
      if (j >= src.length) throw new Error('Unclosed tag');
      const raw = src.slice(lt + 1, j);
      i = j + 1;
      if (raw[0] === '/') {
        const name = local(raw.slice(1).trim());
        const open = stack.pop();
        if (!open || open.name !== name) throw new Error(`Mismatched </${name}>`);
        continue;
      }
      const self = raw.endsWith('/');
      const body = self ? raw.slice(0, -1) : raw;
      const m = /^([^\s/>]+)/.exec(body);
      if (!m) throw new Error('Bad tag');
      const node = { name: local(m[1]), attrs: {}, children: [], text: '' };
      body.slice(m[1].length).replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (x, k, v, a, b) => { node.attrs[local(k)] = decode(a ?? b ?? ''); return ''; });
      top.children.push(node);
      if (!self) stack.push(node);
    }
    if (stack.length !== 1) throw new Error(`Unclosed <${stack[stack.length - 1].name}>`);
    return rootNode;
  }
  const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
  // path 'A/B/C': the first matching descendant chain
  function at(n, path) {
    let cur = n;
    for (const p of path.split('/')) { cur = cur && cur.children.find((c) => c.name === p); if (!cur) return null; }
    return cur;
  }
  const txt = (n, path) => { const x = path ? at(n, path) : n; return x ? x.text.trim() : ''; };
  const firstTxt = (n, paths) => { for (const p of paths) { const v = txt(n, p); if (v) return v; } return ''; };

  // ---------- money and dates ----------
  const toCents = (s) => Math.round(Number(s) * 100);
  // A key that identifies the same bank transaction when a statement is imported twice.
  function hashKey(s) {
    let h = 5381;
    for (let k = 0; k < s.length; k++) h = ((h * 33) ^ s.charCodeAt(k)) >>> 0;
    return h.toString(36);
  }

  // ---------- camt.053 ----------
  function parseCamt053(text) {
    const doc = parseXml(text);
    const top = doc.children.find((c) => c.name === 'Document') || doc.children[0];
    const stmtRoot = top && (top.name === 'BkToCstmrStmt' ? top : at(top, 'BkToCstmrStmt'));
    if (!stmtRoot) throw new Error('This is not a camt.053 bank statement (no BkToCstmrStmt).');
    const statements = [];
    const txs = [];
    let skipped = { debit: 0, pending: 0, reversal: 0 };
    for (const st of kids(stmtRoot, 'Stmt')) {
      const stmt = {
        id: txt(st, 'Id'), seq: txt(st, 'ElctrncSeqNb') || txt(st, 'LglSeqNb'), iban: txt(st, 'Acct/Id/IBAN'),
        from: txt(st, 'FrToDt/FrDtTm').slice(0, 10), to: txt(st, 'FrToDt/ToDtTm').slice(0, 10), created: txt(st, 'CreDtTm'),
      };
      statements.push(stmt);
      kids(st, 'Ntry').forEach((e, ei) => {
        const dir = txt(e, 'CdtDbtInd');
        const status = txt(e, 'Sts/Cd') || txt(e, 'Sts');
        if (txt(e, 'RvslInd') === 'true') { skipped.reversal++; return; }
        if (dir !== 'CRDT') { skipped.debit++; return; }
        if (status && status !== 'BOOK') { skipped.pending++; return; }
        const date = (firstTxt(e, ['BookgDt/Dt', 'BookgDt/DtTm', 'ValDt/Dt', 'ValDt/DtTm'])).slice(0, 10);
        const entryRef = txt(e, 'AcctSvcrRef') || txt(e, 'NtryRef');
        const details = [];
        for (const d of kids(e, 'NtryDtls')) details.push(...kids(d, 'TxDtls'));
        const ccyOf = (n) => (n && n.attrs.Ccy) || 'EUR';
        const one = (d, k) => {
          const amtNode = (d && (at(d, 'AmtDtls/TxAmt/Amt') || at(d, 'Amt'))) || null;
          const useEntry = !amtNode || details.length <= 1;
          const amount = useEntry ? toCents(txt(e, 'Amt')) : toCents(amtNode.text.trim());
          const ccy = useEntry ? ccyOf(at(e, 'Amt')) : ccyOf(amtNode);
          const strdRefs = [];
          if (d) for (const ri of kids(d, 'RmtInf')) for (const s of kids(ri, 'Strd')) { const r = txt(s, 'CdtrRefInf/Ref'); if (r) strdRefs.push(r); }
          const ustrd = d ? kids(d, 'RmtInf').flatMap((ri) => kids(ri, 'Ustrd').map((u) => u.text.trim())).join(' ') : txt(e, 'AddtlNtryInf');
          const name = d ? firstTxt(d, ['RltdPties/Dbtr/Pty/Nm', 'RltdPties/Dbtr/Nm', 'RltdPties/UltmtDbtr/Pty/Nm', 'RltdPties/UltmtDbtr/Nm']) : '';
          const iban = d ? txt(d, 'RltdPties/DbtrAcct/Id/IBAN') : '';
          const e2e = d ? txt(d, 'Refs/EndToEndId') : '';
          const txRef = d ? txt(d, 'Refs/AcctSvcrRef') : '';
          const reference = strdRefs[0] || (e2e && e2e !== 'NOTPROVIDED' ? e2e : '');
          const key = (txRef || entryRef) ? `camt:${stmt.iban}:${txRef || `${entryRef}#${k}`}` : `camt:${hashKey([stmt.iban, date, amount, reference, name, ustrd, ei, k].join('|'))}`;
          txs.push({ key, date, amount, currency: ccy, reference, references: [...strdRefs, e2e].filter((x) => x && x !== 'NOTPROVIDED'), name, iban, purpose: ustrd || txt(e, 'AddtlNtryInf'), statementId: stmt.id });
        };
        if (details.length) details.forEach((d, k) => one(d, k)); else one(null, 0);
      });
    }
    return { format: 'camt.053', statements, txs, skipped };
  }

  // ---------- CSV (bank exports differ: the columns are recognised by their names) ----------
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  function parseDelimited(text) {
    const src = String(text).replace(/^﻿/, '');
    const firstLines = src.split(/\r?\n/).slice(0, 10).join('\n');
    const count = (ch) => (firstLines.match(new RegExp(ch === '\t' ? '\\t' : `\\${ch}`, 'g')) || []).length;
    const delim = [';', '\t', ','].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return { delim, rows: rows.filter((r) => r.some((c) => String(c).trim() !== '')) };
  }
  // Column roles and the header words that name them (Slovenian, Croatian and English bank exports).
  const ROLES = {
    date: ['datum knjizenja', 'datum valute', 'datum izvrsitve', 'datum transakcije', 'datum placila', 'datum', 'booking date', 'value date', 'transaction date', 'date', 'datum knjizenja/valute'],
    credit: ['v dobro', 'dobro', 'priliv', 'prilivi', 'credit', 'credit amount', 'uplata', 'potrazuje', 'znesek v dobro', 'in'],
    debit: ['v breme', 'breme', 'odliv', 'odlivi', 'debit', 'debit amount', 'isplata', 'duguje', 'znesek v breme', 'out'],
    amount: ['znesek', 'amount', 'iznos', 'vrednost', 'znesek eur', 'amount eur'],
    direction: ['d/c', 'c/d', 'smer', 'dobro/breme', 'breme/dobro', 'type', 'vrsta'],
    reference: ['sklic prejemnika', 'sklic odobritve', 'referenca prejemnika', 'sklic', 'referenca', 'reference', 'creditor reference', 'model in sklic', 'poziv na broj', 'payment reference', 'remittance reference'],
    name: ['naziv placnika', 'placnik', 'naziv partnerja', 'partner', 'nasprotna stranka', 'naziv', 'ime', 'name', 'payer', 'counterparty', 'counterparty name', 'debtor', 'naziv prejemnika/placnika', 'prejemnik/placnik'],
    iban: ['iban placnika', 'racun placnika', 'iban', 'racun', 'trr', 'account', 'counterparty account', 'stevilka racuna'],
    purpose: ['namen placila', 'namen', 'opis', 'purpose', 'description', 'details', 'opis transakcije', 'remittance information'],
  };
  function detectColumns(header) {
    const h = header.map(fold);
    const used = new Set();
    const map = {};
    // exact name first, then "starts with", then "contains", role by role in a fixed order
    const order = ['credit', 'debit', 'reference', 'date', 'amount', 'direction', 'name', 'iban', 'purpose'];
    for (const pass of ['exact', 'start', 'contains']) {
      for (const role of order) {
        if (map[role] != null) continue;
        for (const word of ROLES[role]) {
          const k = h.findIndex((x, idx) => !used.has(idx) && (pass === 'exact' ? x === word : pass === 'start' ? x.startsWith(word) : (word.length > 3 && x.includes(word))));
          if (k >= 0) { map[role] = k; used.add(k); break; }
        }
      }
    }
    return map;
  }
  // "1.234,56", "-1.234,56", "1234,56", "1,234.56", "1234.56", "1 234,56 €", "−12,00" → cents. decimalComma: the file's habit.
  function parseAmount(raw, decimalComma) {
    let s = String(raw || '').replace(/[\s €]|EUR/gi, '').replace(/[−–]/g, '-');
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (hasC) s = decimalComma === false && /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (hasD && decimalComma && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const c = Math.round(Number(s) * 100);
    return neg ? -c : c;
  }
  function parseDate(raw) {
    const s = String(raw || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})/.exec(s);
    if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${C.pad(m[2], 2)}-${C.pad(m[1], 2)}`; }
    return '';
  }
  // map: optional column choice { date, amount | credit/debit, direction, reference, name, iban, purpose } (indexes)
  function parseCsvStatement(text, map0) {
    const { rows, delim } = parseDelimited(text);
    if (!rows.length) throw new Error('The file is empty.');
    // header: the first row (within the first 15) that names a date and an amount column
    let hi = 0, auto = {};
    for (let k = 0; k < Math.min(rows.length, 15); k++) {
      const m = detectColumns(rows[k]);
      if (m.date != null && (m.amount != null || m.credit != null)) { hi = k; auto = m; break; }
    }
    const header = rows[hi];
    const map = { ...auto, ...(map0 || {}) };
    for (const k of Object.keys(map)) if (map[k] === '' || map[k] == null || map[k] < 0) delete map[k];
    const body = rows.slice(hi + 1);
    const cellsOf = (k) => (map[k] == null ? [] : body.map((r) => r[map[k]] || ''));
    const amountCells = [...cellsOf('amount'), ...cellsOf('credit'), ...cellsOf('debit')];
    const decimalComma = amountCells.some((v) => /,\d{1,2}\s*(€|EUR)?\s*-?$/.test(String(v).trim())) ? true
      : amountCells.some((v) => /\.\d{1,2}\s*(€|EUR)?\s*-?$/.test(String(v).trim())) ? false : true;
    const txs = [];
    const skipped = { debit: 0, unreadable: 0 };
    body.forEach((r, k) => {
      const get = (role) => (map[role] == null ? '' : String(r[map[role]] ?? '').trim());
      const date = parseDate(get('date'));
      let amount = null;
      if (map.credit != null || map.debit != null) {
        const cr = parseAmount(get('credit'), decimalComma), db = parseAmount(get('debit'), decimalComma);
        if (cr) amount = Math.abs(cr); else if (db) amount = -Math.abs(db);
      } else {
        amount = parseAmount(get('amount'), decimalComma);
        const dir = fold(get('direction'));
        if (amount != null && dir) {
          if (/^(d|db|dr|debit|breme|v breme|odliv|out|-)$/.test(dir)) amount = -Math.abs(amount);
          else if (/^(c|cr|credit|dobro|v dobro|priliv|in|\+)$/.test(dir)) amount = Math.abs(amount);
        }
      }
      if (!date || amount == null) { skipped.unreadable++; return; }
      if (!(amount > 0)) { skipped.debit++; return; }
      const reference = get('reference'), name = get('name'), iban = get('iban').replace(/\s+/g, '').toUpperCase(), purpose = get('purpose');
      txs.push({ key: `csv:${hashKey([date, amount, reference, name, iban, purpose].join('|'))}`, date, amount, currency: 'EUR', reference,
        references: reference ? [reference] : [], name, iban, purpose, statementId: '', row: hi + 2 + k });
    });
    // two identical rows in one file (same day, amount, payer, reference) are two payments: give them distinct keys
    const seen = new Map();
    for (const t of txs) { const n = seen.get(t.key) || 0; seen.set(t.key, n + 1); if (n) t.key = `${t.key}#${n}`; }
    return { format: 'csv', delim, header, map, auto, statements: [], txs, skipped };
  }

  function parseStatement(text, { name = '', map } = {}) {
    const head = String(text).replace(/^﻿/, '').trimStart().slice(0, 400);
    if (head.startsWith('<')) {
      if (!/camt\.05[34]|BkToCstmrStmt/.test(String(text).slice(0, 4000))) throw new Error('This XML file is not a camt.053 bank statement.');
      return parseCamt053(text);
    }
    if (/\.xml$/i.test(name)) throw new Error('This XML file could not be read.');
    return parseCsvStatement(text, map);
  }

  // ---------- matching ----------
  const normRef = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  const LEGAL = /\b(d\.?\s?o\.?\s?o\.?|d\.?\s?d\.?|s\.?\s?p\.?|k\.?\s?d\.?|d\.?\s?n\.?\s?o\.?|gmbh|ag|inc|llc|ltd|limited|srl|s\.?r\.?l\.?|spa|bv|oy|ab|as|sa|sas|kg|ohg|doo|zoo)\b\.?/g;
  const nameTokens = (s) => fold(s).replace(LEGAL, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2);
  function namesMatch(a, b) {
    const ta = nameTokens(a), tb = new Set(nameTokens(b));
    if (!ta.length || !tb.size) return false;
    const common = ta.filter((w) => tb.has(w)).length;
    return common >= Math.min(2, ta.length, tb.size);
  }
  // Invoice numbers ("2026-0001", with or without the prefix) and SI00 references in a free text.
  function referencesIn(text) {
    const out = [];
    const s = String(text || '');
    for (const m of s.matchAll(/SI\s?00\s?(\d{4})\s?-\s?(\d{1,6})(?![\d-])/gi)) out.push({ year: Number(m[1]), seq: Number(m[2]), how: 'reference' });
    for (const m of s.matchAll(/(?<!\d)(?<!\d-)(20\d{2})-(\d{4})(?![\d-])/g)) out.push({ year: Number(m[1]), seq: Number(m[2]), how: 'number' });
    return out;
  }
  const isProformaRef = (r) => /^SI0099-\d{4}-\d{1,6}$/.test(normRef(r));

  // The ids of bank transactions already recorded as payments (an earlier import of the same statement).
  function recordedKeys(state) {
    const keys = new Map();
    for (const inv of state.invoices) for (const p of inv.payments || []) if (p.bankKey) keys.set(p.bankKey, inv);
    return keys;
  }
  const openInvoices = (state) => state.invoices.filter((i) => i.number && i.kind !== 'credit_note' && C.outstandingCents(state, i) > 0);

  // Suggest an invoice for every incoming payment. Returns rows: { tx, invoiceId, how, selected }.
  function suggest(state, txs) {
    const issued = state.invoices.filter((i) => i.number && i.kind !== 'credit_note');
    const byRef = new Map(issued.map((i) => [normRef(i.snapshot.reference || i.reference), i]));
    const byYearSeq = new Map(issued.map((i) => [`${i.year}-${i.seq}`, i]));
    const open = openInvoices(state);
    return txs.map((tx) => {
      let inv = null, how = 'none';
      for (const r of tx.references || []) { const hit = byRef.get(normRef(r)); if (hit) { inv = hit; how = 'reference'; break; } }
      if (!inv) {
        // the full invoice number (with its prefix) written in the reference or the purpose
        const text = ` ${[tx.reference, tx.purpose].join(' ').toUpperCase()} `;
        const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasPrefix = (num) => !/^\d{4}-\d{4}$/.test(num); // without a prefix, the year-number pattern below finds it
        const hit = issued.find((i) => hasPrefix(i.number) && new RegExp(`[^A-Z0-9]${esc(i.number.toUpperCase())}[^A-Z0-9]`).test(text));
        if (hit) { inv = hit; how = 'number'; }
      }
      if (!inv) {
        const found = referencesIn([tx.reference, tx.purpose].join(' '));
        const hit = found.map((f) => ({ f, i: byYearSeq.get(`${f.year}-${f.seq}`) })).find((x) => x.i);
        if (hit) { inv = hit.i; how = hit.f.how === 'reference' ? 'reference' : 'number'; }
      }
      if (!inv) {
        const same = open.filter((i) => C.outstandingCents(state, i) === tx.amount);
        const named = same.filter((i) => namesMatch(tx.name, (state.clients.find((c) => c.id === i.clientId) || {}).name || i.snapshot.customer.name));
        if (named.length === 1) { inv = named[0]; how = 'amount_name'; } else if (named.length === 0 && same.length === 1) { inv = same[0]; how = 'amount'; }
      }
      const proforma = !inv && (tx.references || []).some(isProformaRef) ? (tx.references || []).find(isProformaRef) : '';
      return { tx, invoiceId: inv ? inv.id : '', how, proforma, selected: !!inv && how !== 'amount' };
    });
  }

  // Check every row against the data, in order (two payments for one invoice share its open amount).
  // Adds { problem, note, amount (what would be recorded), recordable }.
  function evaluate(state, rows, today = C.todayIso()) {
    const recorded = recordedKeys(state);
    const used = new Map(); // invoiceId → cents allocated by earlier rows
    for (const r of rows) {
      r.problem = ''; r.note = ''; r.amount = 0; r.recordable = false; r.done = false;
      const inv = r.invoiceId ? state.invoices.find((i) => i.id === r.invoiceId) : null;
      if (recorded.has(r.tx.key)) { r.problem = `Already recorded on ${recorded.get(r.tx.key).number}`; r.selected = false; r.done = true; continue; }
      if (r.tx.currency && r.tx.currency !== 'EUR') { r.problem = `In ${r.tx.currency}, not EUR`; r.selected = false; continue; }
      if (!inv) { r.problem = r.proforma ? `Reference of proforma ${r.proforma}: convert it to an invoice first` : 'No matching invoice'; r.selected = false; continue; }
      if (!inv.number || inv.kind === 'credit_note') { r.problem = 'Not an issued invoice'; r.selected = false; continue; }
      if (!r.tx.date || r.tx.date < inv.issueDate) { r.problem = `Paid ${C.dmy(r.tx.date)}, before the invoice date ${C.dmy(inv.issueDate)}: record it by hand if right`; r.selected = false; continue; }
      if (r.tx.date > today) { r.problem = 'Dated in the future'; r.selected = false; continue; }
      const open = C.outstandingCents(state, inv) - (used.get(inv.id) || 0);
      if (open <= 0) { r.problem = `${inv.number} is already paid`; r.selected = false; continue; }
      const dup = (inv.payments || []).find((p) => !p.bankKey && p.date === r.tx.date && p.amount === r.tx.amount);
      if (dup) r.note = 'A payment of this amount on this day is already recorded by hand: check it is not the same one';
      r.amount = Math.min(open, r.tx.amount);
      if (r.tx.amount > open) r.note = `${C.eur(r.tx.amount - open)} more than still due: only ${C.eur(open)} is recorded`;
      r.recordable = true;
      if (r.selected) used.set(inv.id, (used.get(inv.id) || 0) + r.amount);
    }
    return rows;
  }

  const api = { parseXml, parseCamt053, parseDelimited, detectColumns, parseAmount, parseDate, parseCsvStatement, parseStatement,
    normRef, namesMatch, referencesIn, isProformaRef, recordedKeys, suggest, evaluate, ROLES };
  root.BillingBank = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
