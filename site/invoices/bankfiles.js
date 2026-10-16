/* Business Apps · Invoices — files for and from the bank. Pure functions: window.InvoiceBank, or module.exports in Node.
 *
 *   validatePayment(p)        what is wrong with one credit transfer (IBAN, BIC, amount, name, reference)
 *   buildPain001(run)         a SEPA credit transfer file, ISO 20022 pain.001.001.03 (the version Slovenian banks
 *                             take for batch uploads), or the list of errors that stop it
 *   parseCamt(text)           bank statement entries from camt.053 (also camt.052 / camt.054, any .001.0x version)
 *   parseBankCsv(text)        the same from a CSV export (Slovenian / English column names, ; or , and decimal commas)
 *   matchPayments(txs, open)  which outgoing payment paid which open invoice (reference, end-to-end id, amount, IBAN, name)
 *
 * Sources: EPC SEPA Credit Transfer Customer-to-PSP Implementation Guidelines (EPC132-08) for pain.001.001.03: SEPA
 * service level, EUR only, ChrgBr SLEV, 1 RmtInf either unstructured (max 140) or structured (CdtrRefInf, Ref max 35),
 * SEPA "Latin" character set, BIC optional for payments inside the EEA. ISO 11649 for RF creditor references
 * (mod 97 = 1). Slovenian references ("SI" + 2-digit model + up to 22 digits/hyphens) per the ZBS UPN / SEPA guidelines:
 * banks carry them as a structured creditor reference. CONFIRM WITH YOUR BANK: test-upload one file first; some banks
 * want BIC on every payment or a different reference type for SI models.
 */
(function (root) {
  'use strict';

  var X = root && root.InvoiceEInvoice ? root.InvoiceEInvoice : (typeof require === 'function' ? require('./einvoice.js') : null);

  function r2(n) { return Math.round(n * 100) / 100; }
  function compact(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }

  // ---------- checks ----------

  function mod97(s) {
    var rem = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      var v = c >= 65 && c <= 90 ? String(c - 55) : s.charAt(i);
      for (var k = 0; k < v.length; k++) rem = (rem * 10 + (+v.charAt(k))) % 97;
    }
    return rem;
  }
  // ISO 13616: country, 2 check digits, up to 30 alphanumerics; mod 97 of the rearranged string is 1
  var IBAN_LEN = { SI: 19, HR: 21, AT: 20, DE: 22, IT: 27, HU: 28, FR: 27, NL: 18, BE: 16, ES: 24, IE: 22, LU: 20, CZ: 24, SK: 24, PL: 28, GB: 22, CH: 21, DK: 18, SE: 24, FI: 18, PT: 25, LT: 20, LV: 21, EE: 20, BG: 22, RO: 24, GR: 27, CY: 28, MT: 31, NO: 15, RS: 22, BA: 20, ME: 22, MK: 19 };
  function ibanValid(iban) {
    var s = compact(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    if (IBAN_LEN[s.slice(0, 2)] && IBAN_LEN[s.slice(0, 2)] !== s.length) return false;
    return mod97(s.slice(4) + s.slice(0, 4)) === 1;
  }
  // ISO 9362: 4 bank, 2 country, 2 location, optional 3 branch
  function bicValid(bic) { return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(bic)); }

  // SEPA countries (EPC list of participants) — a creditor outside needs a different (SWIFT) payment, not a SEPA file
  var SEPA = 'AT BE BG CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MC MT NL NO PL PT RO SE SI SK SM VA AD AL ME MD MK RS'.split(' ');

  // Slovenian models ZBS: 00 (no check digit) … 12, 18, 19, 28, 38, 48, 55, 99 (no reference). HR models similar.
  function referenceInfo(ref) {
    var s = compact(ref);
    if (!s) return { kind: 'none', value: '' };
    if (/^RF\d{2}[A-Z0-9]{1,21}$/.test(s)) return { kind: 'rf', value: s, ok: mod97(s.slice(4) + s.slice(0, 4)) === 1 };
    var si = s.match(/^(SI|HR)(\d{2})([0-9\-]{0,22})$/);
    if (si) {
      var known = si[1] === 'SI' ? ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '18', '19', '28', '38', '48', '55', '99'] : null;
      var hyphens = (si[3].match(/-/g) || []).length;
      var ok = (!known || known.indexOf(si[2]) !== -1) && hyphens <= 2 && !/^-|-$|--/.test(si[3]) && (si[2] === '99' || /\d/.test(si[3]));
      return { kind: si[1].toLowerCase(), value: s, model: si[2], ok: ok };
    }
    return { kind: 'text', value: String(ref).trim() };
  }

  // the SEPA basic Latin set: a–z A–Z 0–9 / - ? : ( ) . , ' + space. č→c, š→s, ž→z, đ→d …; anything else becomes a space
  function sepaText(s, max) {
    var t = String(s == null ? '' : s).replace(/[đĐ]/g, function (c) { return c === 'đ' ? 'd' : 'D'; }).replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, '+').replace(/[^A-Za-z0-9\/\-?:().,'+ ]/g, ' ').replace(/\s+/g, ' ').trim();
    return max ? t.slice(0, max).trim() : t;
  }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }

  // the demo's fictional accounts have check digits 00 (never a real account): accepted only with opts.sampleIban
  function sampleIban(iban) { var s = compact(iban); return /^[A-Z]{2}00[A-Z0-9]{11,30}$/.test(s) && (!IBAN_LEN[s.slice(0, 2)] || IBAN_LEN[s.slice(0, 2)] === s.length); }
  function ibanOk(iban, opts) { return ibanValid(iban) || (!!(opts && opts.sampleIban) && sampleIban(iban)); }

  // one payment: { id, amount, currency, creditor: { name, iban, bic }, reference, remittance, endToEnd }
  function validatePayment(p, opts) {
    var e = [];
    var w = [];
    var iban = compact(p.creditor && p.creditor.iban);
    if (!iban) e.push('No IBAN of the vendor');
    else if (!ibanOk(iban, opts)) e.push('The vendor IBAN ' + iban + ' is not valid (check digits or length)');
    else if (SEPA.indexOf(iban.slice(0, 2)) === -1) e.push('The vendor account is outside SEPA (' + iban.slice(0, 2) + '): pay it by SWIFT');
    var bic = compact(p.creditor && p.creditor.bic);
    if (bic && !bicValid(bic)) e.push('The BIC ' + bic + ' is not valid');
    if (!sepaText(p.creditor && p.creditor.name)) e.push('No vendor name');
    if ((p.currency || 'EUR') !== 'EUR') e.push('SEPA transfers are in EUR only (this one is ' + p.currency + ')');
    if (!(p.amount > 0)) e.push('Nothing to pay');
    else if (p.amount > 999999999.99) e.push('The amount is too large');
    else if (Math.abs(r2(p.amount) - p.amount) > 1e-9) e.push('The amount has more than 2 decimals');
    var ref = referenceInfo(p.reference);
    if ((ref.kind === 'rf' || ref.kind === 'si' || ref.kind === 'hr') && !ref.ok) e.push('The reference ' + ref.value + ' is not valid (' + (ref.kind === 'rf' ? 'RF check digits' : 'model or format') + ')');
    if (ref.kind !== 'none' && ref.value.length > 35 && ref.kind !== 'text') e.push('The reference is longer than 35 characters');
    if (ref.kind === 'none') w.push('No payment reference: the invoice number goes in the payment description');
    if (ref.kind === 'si' && ref.model === '00') w.push('Model SI00 has no check digit; the reference is not verified');
    if (!ibanValid(iban) && ibanOk(iban, opts)) w.push('Sample account (demo only)');
    return { errors: e, warnings: w, reference: ref };
  }

  function msgId(date) {
    var d = date || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'INV' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  // run: { msgId, createdAt (ISO), execDate (YYYY-MM-DD), debtor: { name, iban, bic }, payments: [...] }
  // returns { ok, xml, errors: [{ id, messages }], count, total }
  function buildPain001(run, opts) {
    var errors = [];
    var D = run.debtor || {};
    var dErr = [];
    if (!sepaText(D.name)) dErr.push('Your company name is missing');
    if (!ibanOk(D.iban, opts)) dErr.push('Your company IBAN is missing or not valid');
    if (D.bic && !bicValid(D.bic)) dErr.push('Your BIC is not valid');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(run.execDate || '')) dErr.push('Pick the payment date');
    if (dErr.length) errors.push({ id: 'debtor', messages: dErr });
    var pays = run.payments || [];
    if (!pays.length) errors.push({ id: 'run', messages: ['No invoices selected'] });
    var checked = pays.map(function (p) {
      var v = validatePayment(p, opts);
      if (v.errors.length) errors.push({ id: p.id, messages: v.errors });
      return { p: p, v: v };
    });
    if (errors.length) return { ok: false, errors: errors, xml: '', count: pays.length, total: r2(pays.reduce(function (s, p) { return s + (+p.amount || 0); }, 0)) };
    var total = r2(pays.reduce(function (s, p) { return s + p.amount; }, 0));
    var id = sepaText(run.msgId || msgId(), 35).replace(/\s/g, '');
    var created = (run.createdAt || new Date().toISOString()).slice(0, 19);
    var agent = function (bic) { return bic ? '<FinInstnId><BIC>' + compact(bic) + '</BIC></FinInstnId>' : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>'; };
    var tx = checked.map(function (c, i) {
      var p = c.p;
      var ref = c.v.reference;
      var e2e = sepaText(p.endToEnd || '', 35) || 'NOTPROVIDED';
      var rmt;
      if (ref.kind === 'rf' || ref.kind === 'si' || ref.kind === 'hr') {
        // structured creditor reference: SCOR for RF; SI/HR models go in Ref as printed on the UPN (spaces removed)
        rmt = '<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>' + xmlEsc(ref.value) + '</Ref></CdtrRefInf></Strd></RmtInf>';
      } else {
        var u = sepaText([ref.kind === 'text' ? ref.value : '', p.remittance].filter(Boolean).join(' '), 140);
        rmt = u ? '<RmtInf><Ustrd>' + xmlEsc(u) + '</Ustrd></RmtInf>' : '';
      }
      return '      <CdtTrfTxInf>\n' +
        '        <PmtId><InstrId>' + xmlEsc(sepaText(id.slice(0, 28) + '-' + (i + 1), 35).replace(/\s/g, '')) + '</InstrId><EndToEndId>' + xmlEsc(e2e) + '</EndToEndId></PmtId>\n' +
        '        <Amt><InstdAmt Ccy="EUR">' + p.amount.toFixed(2) + '</InstdAmt></Amt>\n' +
        (p.creditor.bic ? '        <CdtrAgt>' + agent(p.creditor.bic) + '</CdtrAgt>\n' : '') +
        '        <Cdtr><Nm>' + xmlEsc(sepaText(p.creditor.name, 70)) + '</Nm></Cdtr>\n' +
        '        <CdtrAcct><Id><IBAN>' + compact(p.creditor.iban) + '</IBAN></Id></CdtrAcct>\n' +
        '        <Purp><Cd>SUPP</Cd></Purp>\n' +
        (rmt ? '        ' + rmt + '\n' : '') +
        '      </CdtTrfTxInf>';
    });
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
      '  <CstmrCdtTrfInitn>\n' +
      '    <GrpHdr><MsgId>' + xmlEsc(id) + '</MsgId><CreDtTm>' + created + '</CreDtTm><NbOfTxs>' + pays.length + '</NbOfTxs><CtrlSum>' + total.toFixed(2) + '</CtrlSum><InitgPty><Nm>' + xmlEsc(sepaText(D.name, 70)) + '</Nm></InitgPty></GrpHdr>\n' +
      '    <PmtInf>\n' +
      '      <PmtInfId>' + xmlEsc(id.slice(0, 31) + '-P1') + '</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>' + pays.length + '</NbOfTxs><CtrlSum>' + total.toFixed(2) + '</CtrlSum>\n' +
      '      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>\n' +
      '      <ReqdExctnDt>' + run.execDate + '</ReqdExctnDt>\n' +
      '      <Dbtr><Nm>' + xmlEsc(sepaText(D.name, 70)) + '</Nm></Dbtr>\n' +
      '      <DbtrAcct><Id><IBAN>' + compact(D.iban) + '</IBAN></Id><Ccy>EUR</Ccy></DbtrAcct>\n' +
      '      <DbtrAgt>' + agent(D.bic) + '</DbtrAgt>\n' +
      '      <ChrgBr>SLEV</ChrgBr>\n' +
      tx.join('\n') + '\n' +
      '    </PmtInf>\n  </CstmrCdtTrfInitn>\n</Document>\n';
    return { ok: true, xml: xml, errors: [], count: pays.length, total: total, msgId: id };
  }

  // ---------- statements ----------

  function dateOnly(s) {
    var m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = String(s || '').trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/) || String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) { var d = +m[1], mo = +m[2]; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return m[3] + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d; }
    return null;
  }

  // camt.053 (BkToCstmrStmt/Stmt), camt.052 (BkToCstmrAcctRpt/Rpt), camt.054 (BkToCstmrDbtCdtNtfctn/Ntfctn)
  function parseCamt(text) {
    if (!X) throw new Error('XML reader missing');
    var doc = X.parseXml(text);
    var body = X.kid(doc, 'BkToCstmrStmt') || X.kid(doc, 'BkToCstmrAcctRpt') || X.kid(doc, 'BkToCstmrDbtCdtNtfctn');
    if (doc.name !== 'Document' || !body) throw new Error('this XML is not a camt bank statement');
    var reports = X.kids(body, 'Stmt').concat(X.kids(body, 'Rpt'), X.kids(body, 'Ntfctn'));
    var out = { account: '', transactions: [] };
    var T = X.txt;
    reports.forEach(function (st) {
      var acct = compact(T(st, 'Acct/Id/IBAN'));
      if (acct && !out.account) out.account = acct;
      X.kids(st, 'Ntry').forEach(function (n, ni) {
        var dir = T(n, 'CdtDbtInd') === 'DBIT' ? 'out' : 'in';
        if (/^(PDNG|INFO)$/.test(T(n, 'Sts') || T(n, 'Sts/Cd'))) return; // pending / information only
        var amtNode = X.kid(n, 'Amt');
        var date = dateOnly(T(n, 'BookgDt/Dt') || T(n, 'BookgDt/DtTm') || T(n, 'ValDt/Dt') || T(n, 'ValDt/DtTm'));
        var entryRef = T(n, 'AcctSvcrRef') || T(n, 'NtryRef');
        var details = X.all(n, 'NtryDtls/TxDtls');
        var entryAmt = X.num(T(n, 'Amt'));
        var mk = function (d, i) {
          var amt = d ? (X.num(T(d, 'AmtDtls/TxAmt/Amt')) != null ? X.num(T(d, 'AmtDtls/TxAmt/Amt')) : X.num(T(d, 'Amt'))) : null;
          if (amt == null || details.length <= 1) amt = entryAmt;
          var party = dir === 'out' ? 'Cdtr' : 'Dbtr';
          var name = d ? (T(d, 'RltdPties/' + party + '/Nm') || T(d, 'RltdPties/' + party + '/Pty/Nm')) : '';
          var iban = d ? compact(T(d, 'RltdPties/' + party + 'Acct/Id/IBAN')) : '';
          var ref = d ? (T(d, 'RmtInf/Strd/CdtrRefInf/Ref') || '') : '';
          var ustrd = d ? X.all(d, 'RmtInf/Ustrd').map(function (u) { return u.text.trim(); }).join(' ') : '';
          return {
            id: (entryRef || ('E' + ni)) + (details.length > 1 ? '/' + (i + 1) : ''),
            date: date, amount: amt != null ? Math.abs(amt) : null, currency: (amtNode && amtNode.attrs.Ccy) || 'EUR', direction: dir,
            reference: compact(ref), endToEnd: d ? T(d, 'Refs/EndToEndId').replace(/^NOTPROVIDED$/i, '') : '', name: name, iban: iban,
            text: [ustrd, T(n, 'AddtlNtryInf'), d ? T(d, 'AddtlTxInf') : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
          };
        };
        if (!details.length) out.transactions.push(mk(null, 0));
        else details.forEach(function (d, i) { out.transactions.push(mk(d, i)); });
      });
    });
    out.transactions = out.transactions.filter(function (t) { return t.amount != null && t.date; });
    return out;
  }

  function splitCsv(text, sep) {
    var rows = [];
    var row = [];
    var cell = '';
    var q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
  }
  function normHead(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  // "1.234,56", "-1234.56", "1 234,56 EUR", "(12,00)"
  function amountOf(s) {
    var t = String(s || '').replace(/[\s ]|EUR|€/gi, '').replace(/[−]/g, '-');
    if (!t) return null;
    var neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t);
    t = t.replace(/[()\-+]/g, '');
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    var v = Number(t);
    return isFinite(v) && t !== '' ? (neg ? -v : v) : null;
  }

  var COLS = {
    date: /^(datum( knjizenja| valute| transakcije| izvedbe)?|knjizeno|booking date|value date|date|datum placila)$/,
    debit: /(v breme|breme|debit|odliv|izplacil|withdrawal|placilo)$/,
    credit: /(v dobro|dobro|credit|priliv|deposit)$/,
    amount: /^(znesek|amount|iznos|vrednost|znesek eur|amount eur)$/,
    sign: /^(d\/c|smer|breme\/dobro|debit\/credit|tip)$/,
    reference: /(sklic|referenca|reference|poziv na broj|creditor reference)/,
    name: /(prejemnik|placnik|partner|naziv|name|counterparty|beneficiary|upravicenec|primatelj)/,
    iban: /(iban|racun prejemnika|racun placnika|trr|account)/,
    text: /(namen|opis|description|purpose|details|podrobnosti)/,
    e2e: /(end.?to.?end|e2e)/
  };
  function parseBankCsv(text) {
    var s = String(text || '').replace(/^﻿/, '');
    var first = s.split(/\r?\n/).slice(0, 15).join('\n');
    var sep = [';', '\t', ','].map(function (c) { return [c, (first.match(new RegExp(c === '\t' ? '\t' : '\\' + c, 'g')) || []).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var rows = splitCsv(s, sep);
    var hi = -1;
    var map = null;
    for (var r = 0; r < Math.min(rows.length, 20) && hi === -1; r++) {
      var m = {};
      rows[r].forEach(function (h, i) {
        var n = normHead(h);
        Object.keys(COLS).forEach(function (k) {
          if (!COLS[k].test(n)) return;
          if (k === 'name' && COLS.iban.test(n)) return; // "Račun prejemnika" is the account, not the name
          // the creditor's reference ("Sklic prejemnika") beats the payer's own ("Sklic plačnika")
          if (m[k] == null || (k === 'reference' && /prejemn|creditor|beneficiar/.test(n))) m[k] = i;
        });
      });
      if (m.date != null && (m.amount != null || m.debit != null)) { hi = r; map = m; }
    }
    if (hi === -1) throw new Error('no header with a date and an amount column was found');
    var out = [];
    rows.slice(hi + 1).forEach(function (row, i) {
      var get = function (k) { return map[k] != null ? String(row[map[k]] || '').trim() : ''; };
      var date = dateOnly(get('date'));
      if (!date) return;
      var amt = null;
      var dir = 'out';
      if (map.debit != null || map.credit != null) {
        var d = amountOf(get('debit'));
        var c = amountOf(get('credit'));
        if (d) { amt = Math.abs(d); dir = 'out'; } else if (c) { amt = Math.abs(c); dir = 'in'; }
      }
      if (amt == null && map.amount != null) {
        var a = amountOf(get('amount'));
        if (a == null) return;
        var sg = normHead(get('sign'));
        dir = /^(d|db|dbit|debit|breme|v breme)$/.test(sg) ? 'out' : /^(c|cr|crdt|credit|dobro|v dobro)$/.test(sg) ? 'in' : a < 0 ? 'out' : 'in';
        amt = Math.abs(a);
      }
      if (!(amt > 0)) return;
      out.push({ id: 'csv' + (hi + 2 + i), date: date, amount: r2(amt), currency: 'EUR', direction: dir, reference: compact(get('reference')), endToEnd: get('e2e'), name: get('name'), iban: compact(get('iban')).replace(/[^A-Z0-9]/g, ''), text: get('text') });
    });
    return { account: '', transactions: out };
  }

  // ---------- matching ----------

  function refKey(s) { return compact(s).replace(/[^A-Z0-9]/g, ''); }
  function words(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 4 && !/^(d\.?o\.?o|druzba|storitve|trgovina|gmbh|limited|ltd|inc|ljubljana|maribor)$/.test(w); }); }

  // txs: statement transactions; open: [{ id, vendor, number, reference, iban, open, total, endToEnd }]
  // returns { matches: [{ tx, invoiceId, level, why, amount }], unmatched: [tx] }
  function matchPayments(txs, open) {
    var LEVEL = { exact: 4, reference: 3, likely: 2, possible: 1 };
    var cands = [];
    var outTx = (txs || []).filter(function (t) { return t.direction === 'out' && t.amount > 0; });
    outTx.forEach(function (t) {
      var tRef = refKey(t.reference);
      var tText = refKey(t.text + ' ' + t.reference);
      var tE2e = refKey(t.endToEnd);
      var tWords = words(t.name);
      open.forEach(function (inv) {
        if (!(inv.open > 0)) return;
        var sameAmt = Math.abs(inv.open - t.amount) < 0.005;
        var iRef = refKey(inv.reference);
        var refHit = iRef.length >= 4 && (tRef === iRef || (iRef.length >= 6 && tText.indexOf(iRef) !== -1));
        var num = refKey(inv.number);
        var e2eHit = !!tE2e && ((inv.endToEnd && tE2e === refKey(inv.endToEnd)) || (num.length >= 3 && tE2e === num));
        var numInText = num.length >= 5 && tText.indexOf(num) !== -1;
        var ibanHit = !!t.iban && !!inv.iban && compact(t.iban) === compact(inv.iban);
        var nameHit = tWords.length && words(inv.vendor).some(function (w) { return tWords.indexOf(w) !== -1; });
        var c = null;
        if ((refHit || e2eHit) && sameAmt) c = { level: 'exact', score: 100, why: refHit ? 'same reference and amount' : 'same invoice number (end-to-end id) and amount' };
        else if (refHit || e2eHit) c = { level: 'reference', score: 70, why: (refHit ? 'same reference' : 'same invoice number') + ', different amount (part payment?)' };
        else if (sameAmt && numInText) c = { level: 'likely', score: 85, why: 'same amount, invoice number in the description' };
        else if (sameAmt && ibanHit) c = { level: 'likely', score: 80, why: 'same amount and vendor account' };
        else if (sameAmt && nameHit) c = { level: 'likely', score: 60, why: 'same amount and vendor name' };
        else if (sameAmt) c = { level: 'possible', score: 30, why: 'same amount only' };
        if (c) { c.tx = t; c.invoiceId = inv.id; cands.push(c); }
      });
    });
    // an amount-only match counts only if it's the one invoice with that amount for that payment
    cands = cands.filter(function (c) {
      if (c.level !== 'possible') return true;
      return cands.filter(function (o) { return o.tx === c.tx && o.level === 'possible'; }).length === 1;
    });
    cands.sort(function (a, b) { return b.score - a.score || (a.tx.date < b.tx.date ? -1 : 1); });
    var usedTx = new Set();
    var usedInv = new Set();
    var matches = [];
    cands.forEach(function (c) {
      if (usedTx.has(c.tx) || usedInv.has(c.invoiceId)) return;
      usedTx.add(c.tx);
      usedInv.add(c.invoiceId);
      matches.push({ tx: c.tx, invoiceId: c.invoiceId, level: c.level, rank: LEVEL[c.level], why: c.why, amount: c.tx.amount });
    });
    return { matches: matches, unmatched: outTx.filter(function (t) { return !usedTx.has(t); }), incoming: (txs || []).filter(function (t) { return t.direction !== 'out'; }).length };
  }

  var api = { ibanValid: ibanValid, bicValid: bicValid, referenceInfo: referenceInfo, sepaText: sepaText, validatePayment: validatePayment, buildPain001: buildPain001,
    msgId: msgId, parseCamt: parseCamt, parseBankCsv: parseBankCsv, amountOf: amountOf, matchPayments: matchPayments, SEPA: SEPA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceBank = api;
})(typeof window !== 'undefined' ? window : this);
