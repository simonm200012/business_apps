/* Business Apps · Invoices — from approved to paid: the approval step (likvidacija), the SEPA pay run (pain.001 file for
 * the bank), marking invoices paid from a bank statement (camt.053 or CSV), the e-invoice (XML) preview and the demo with
 * sample invoices. app.js calls InvoicePayFlow.init(core). Everything stays in the browser; no bank is contacted: you
 * upload the file in your online bank yourself, and download the statement from there.
 * Text from files only ever goes into the page through textContent (el()).
 */
(function () {
  'use strict';

  var LEVEL_TEXT = { exact: 'Sure', reference: 'Reference', likely: 'Likely', possible: 'Check' };

  function init(core) {
    var $ = core.$;
    var el = core.el;
    var E = window.InvoiceEInvoice;
    var B = window.InvoiceBank;
    var S = window.InvoiceSamples;
    var st = core.state;

    function r2(n) { return Math.round(n * 100) / 100; }
    function settings() { return st.settings; }
    function approvers() { return settings().approvers || (settings().approvers = []); }
    function payRuns() { return settings().payRuns || (settings().payRuns = []); }
    function byId(id) { return st.invoices.find(function (x) { return x.id === id; }) || null; }

    // ---------- approval (likvidacija) ----------

    // The approval step is optional: off by default for your own invoices (one person approving their own bills adds
    // clicks, not control), always on in the demo. Off: an invoice without a decision counts as approved, so it can go
    // into a pay run. Decisions already made are kept and come back when the step is turned on again.
    function approvalOn() { return !!core.DEMO || settings().approvalStep === true; }
    function applyMode() {
      var on = approvalOn();
      document.documentElement.classList.toggle('no-approval', !on);
      ['approval', 'approved', 'rejected'].forEach(function (v) {
        var o = document.querySelector('#f-status option[value="' + v + '"]');
        if (o) { o.hidden = !on && v !== 'approved'; o.disabled = o.hidden; if (v === 'approved') o.textContent = on ? 'Approved, not sent' : 'Not sent to the bank'; }
      });
      if (!on && (st.filters.status === 'approval' || st.filters.status === 'rejected')) st.filters.status = '';
    }
    function approvalOf(inv) { return (inv.approval && inv.approval.status) || (approvalOn() ? 'pending' : 'approved'); }
    // waiting: checked, not paid, not a credit note, nobody approved or rejected it yet
    function waiting(inv) { return !inv.paid && !core.isCredit(inv) && inv.status !== 'review' && approvalOf(inv) === 'pending'; }
    function approvedOpen(inv) { return !inv.paid && !core.isCredit(inv) && approvalOf(inv) === 'approved'; }
    function sentOpen(inv) { return !inv.paid && !core.isCredit(inv) && !!inv.payRun; }

    function matches(inv, s) {
      if (s === 'approval') return waiting(inv);
      if (s === 'approved') return approvedOpen(inv) && !inv.payRun;
      if (s === 'rejected') return !core.isCredit(inv) && approvalOf(inv) === 'rejected';
      if (s === 'sent') return sentOpen(inv);
      return null;
    }

    function statusTags(inv) {
      if (core.isCredit(inv)) return [];
      var a = approvalOf(inv);
      if (!inv.paid && inv.payRun) return [el('span', { class: 'atag sent', text: 'Sent to bank ' + core.dateStr(inv.payRun.date) })];
      if (inv.paid) return [];
      if (!approvalOn()) return a === 'rejected' ? [el('span', { class: 'atag bad', text: 'Rejected' })] : [];
      if (a === 'approved') return [el('span', { class: 'atag ok', text: 'Approved' })];
      if (a === 'rejected') return [el('span', { class: 'atag bad', text: 'Rejected' })];
      if (inv.status !== 'review') return [el('span', { class: 'atag wait', text: 'Awaiting approval' })];
      return [];
    }

    var cur = null;
    function onOpen(inv) {
      cur = inv;
      var credit = core.isCredit(inv);
      $('appr-box').hidden = credit || !approvalOn();
      fillApprovers();
      var a = inv.approval || {};
      $('appr-by').value = a.by || settings().lastApprover || '';
      $('appr-comment').value = '';
      renderApproval();
    }
    function fillApprovers() {
      var dl = $('approver-list');
      dl.textContent = '';
      approvers().forEach(function (n) { dl.append(el('option', { value: n })); });
    }
    function renderApproval() {
      var inv = cur;
      if (!inv) return;
      var a = approvalOf(inv);
      var p = $('appr-state');
      p.className = 'pill ' + (a === 'approved' ? 'ok' : a === 'rejected' ? 'bad' : 'warn');
      p.textContent = a === 'approved' ? 'Approved' : a === 'rejected' ? 'Rejected' : 'Waiting for approval';
      var A = inv.approval || {};
      $('appr-meta').textContent = a === 'pending'
        ? 'Before paying, someone confirms the invoice is correct: goods received or work done, price as agreed. Only approved invoices go into a pay run.'
        : (a === 'approved' ? 'Approved by ' : 'Rejected by ') + (A.by || '–') + ' on ' + core.dateStr(A.date) + (A.comment ? ' · "' + A.comment + '"' : '');
      $('appr-ok').hidden = a === 'approved';
      $('appr-no').hidden = a === 'rejected';
      $('appr-reset').hidden = a === 'pending';
      var ul = $('appr-hist');
      ul.textContent = '';
      (A.history || []).slice().reverse().slice(0, 6).forEach(function (h) {
        ul.append(el('li', {}, [el('span', { class: 'num', text: core.dateStr(h.date) }), el('span', { text: (h.status === 'approved' ? 'Approved' : h.status === 'rejected' ? 'Rejected' : 'Back to waiting') + ' · ' + (h.by || '–') + (h.comment ? ' · ' + h.comment : '') })]));
      });
      ul.hidden = !ul.children.length;
    }
    async function setApproval(inv, status, by, comment) {
      var A = inv.approval ? Object.assign({}, inv.approval) : { status: 'pending', history: [] };
      var day = core.todayIso();
      A.history = (A.history || []).concat([{ status: status, by: by, date: day, comment: comment }]).slice(-30);
      A.status = status;
      A.by = status === 'pending' ? '' : by;
      A.date = status === 'pending' ? '' : day;
      A.comment = status === 'pending' ? '' : comment;
      inv.approval = A;
      inv.updatedAt = new Date().toISOString();
      if (by && approvers().indexOf(by) === -1) approvers().push(by);
      if (by) settings().lastApprover = by;
      await core.idb.put('invoices', inv);
      await core.saveSettings();
    }
    async function decide(status) {
      var inv = cur;
      if (!inv) return;
      var by = $('appr-by').value.trim().slice(0, 80);
      var comment = $('appr-comment').value.trim().slice(0, 300);
      if (status !== 'pending' && !by) { core.toast('Enter who approves the invoice.'); $('appr-by').focus(); return; }
      if (status === 'rejected' && !comment) { core.toast('Say why it is rejected (the comment), so the vendor can be told.'); $('appr-comment').focus(); return; }
      try { await setApproval(inv, status, by, comment); } catch (e) { core.toast('Could not save: ' + e.message); return; }
      $('appr-comment').value = '';
      renderApproval();
      fillApprovers();
      core.render();
      $('appr-live').textContent = status === 'approved' ? 'Approved.' : status === 'rejected' ? 'Rejected.' : 'Back to waiting for approval.';
    }
    async function bulkApprove(ids) {
      var list = ids.map(byId).filter(function (x) { return x && !x.paid && !core.isCredit(x) && approvalOf(x) !== 'approved'; });
      if (!list.length) { core.toast('Nothing to approve: the selected invoices are paid, credit notes or already approved.'); return; }
      var by = settings().lastApprover || (approvers()[0] || '');
      by = window.prompt('Approve ' + core.plural(list.length, 'invoice', 'invoices') + ' (' + core.money(core.sum(list, core.remainingEur)) + '). Approved by:', by);
      if (by == null) return;
      by = by.trim().slice(0, 80);
      if (!by) { core.toast('Enter who approves the invoices.'); return; }
      try { for (var i = 0; i < list.length; i++) await setApproval(list[i], 'approved', by, 'Approved in bulk'); } catch (e) { core.toast('Could not save: ' + e.message); return; }
      st.selected = {};
      core.render();
      core.toast(core.plural(list.length, 'invoice', 'invoices') + ' approved by ' + by + '.');
    }

    // ---------- pay run (SEPA pain.001.001.03) ----------

    var prSel = {};
    function payee(inv) {
      // the legal name from the PDF / e-invoice when it contains the name you confirmed; banks compare it with the account
      var d = String(inv.detectedVendor || '');
      var v = String(inv.vendor || '');
      return d && v && window.InvoiceParser.norm(d).indexOf(window.InvoiceParser.norm(v)) !== -1 ? d : (v || d);
    }
    function paymentOf(inv) {
      return { id: inv.id, amount: r2(core.remaining(inv) || 0), currency: inv.currency || 'EUR', creditor: { name: payee(inv), iban: inv.iban, bic: inv.bic || '' },
        reference: inv.reference, remittance: inv.number ? 'Racun ' + inv.number : '', endToEnd: inv.number || '' };
    }
    function runCandidates() {
      var co = $('pr-company').value;
      var withSent = $('pr-sent').checked;
      return st.invoices.filter(function (inv) {
        if (!approvedOpen(inv) || !(core.remaining(inv) > 0)) return false;
        if (inv.payRun && !withSent) return false;
        if (co && co !== core.UNASSIGNED && inv.billedTo !== co) return false;
        if (co === core.UNASSIGNED && core.companyById(inv.billedTo)) return false;
        return true;
      }).sort(function (a, b) { return (a.dueDate || '9') < (b.dueDate || '9') ? -1 : 1; });
    }
    function sampleOk() { return !!core.DEMO; }
    function openRun() {
      var cos = core.companies();
      core.setOptions($('pr-company'), cos.map(function (c) { return [c.id, core.companyLabel(c.id)]; }).concat([[core.UNASSIGNED, 'Unassigned']]), $('pr-company').value || (cos[0] ? cos[0].id : core.UNASSIGNED));
      var due = st.invoices.filter(approvedOpen).map(function (x) { return x.dueDate; }).filter(Boolean).sort()[0];
      var today = core.todayIso();
      $('pr-date').value = due && due > today ? due : nextBusinessDay(today);
      prSel = {};
      fillDebtor();
      renderRun(true);
      $('payrun').showModal();
    }
    function nextBusinessDay(iso) {
      var d = new Date(iso + 'T00:00:00Z');
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    function fillDebtor() {
      var c = core.companyById($('pr-company').value);
      $('pr-iban').value = c && c.iban ? core.formatIban(c.iban) : '';
      $('pr-bic').value = c && c.bic ? c.bic : '';
      $('pr-iban').disabled = $('pr-bic').disabled = !c;
    }
    function renderRun(preselect) {
      var list = runCandidates();
      var ul = $('pr-list');
      ul.textContent = '';
      if (preselect) list.forEach(function (inv) { if (!inv.payRun) prSel[inv.id] = true; });
      var valid = 0;
      list.forEach(function (inv) {
        var p = paymentOf(inv);
        var v = B.validatePayment(p, { sampleIban: sampleOk() });
        var bad = v.errors.length > 0;
        if (bad) delete prSel[inv.id];
        else valid++;
        var cb = el('input', { type: 'checkbox', 'aria-label': 'Pay ' + (inv.vendor || inv.fileName) + ' ' + (inv.number || ''), checked: prSel[inv.id] ? true : null, disabled: bad ? true : null, onchange: function () { if (this.checked) prSel[inv.id] = true; else delete prSel[inv.id]; renderRunSum(); } });
        var info = el('div', { class: 'pr-main' }, [
          el('span', { class: 'pr-v' }, [el('strong', { text: inv.vendor || inv.fileName }), ' ', el('span', { class: 'muted mono', text: inv.number || '' })]),
          el('span', { class: 'pr-m muted', text: [inv.dueDate ? (inv.dueDate < core.todayIso() ? 'overdue since ' : 'due ') + core.dateStr(inv.dueDate) : 'no due date', inv.iban ? core.formatIban(inv.iban) : 'no IBAN', inv.reference || 'no reference', inv.payRun ? 'already sent ' + core.dateStr(inv.payRun.date) : ''].filter(Boolean).join(' · ') })
        ]);
        v.errors.forEach(function (m) { info.append(el('span', { class: 'pr-err', text: m })); });
        v.warnings.forEach(function (m) { info.append(el('span', { class: 'pr-warn', text: m })); });
        var fix = bad ? el('button', { type: 'button', class: 'btn small', text: 'Fix', onclick: function () { $('payrun').close(); core.openDetail(inv.id, []); } }) : null;
        ul.append(el('li', { class: bad ? 'bad' : '' }, [el('label', { class: 'pr-pick' }, [cb]), info, el('span', { class: 'pr-amt num', text: core.money(p.amount, p.currency) }), fix]));
      });
      $('pr-empty').hidden = list.length > 0;
      var nWait = st.invoices.filter(waiting).length;
      var w = $('pr-waiting');
      w.textContent = '';
      if (nWait) w.append(core.plural(nWait, 'unpaid invoice is', 'unpaid invoices are') + ' waiting for approval and not listed. ', el('button', { type: 'button', class: 'link', text: 'Show them', onclick: function () { $('payrun').close(); showWaiting(); } }));
      w.hidden = !nWait;
      renderRunSum();
      renderHistory();
      $('pr-sample').hidden = !core.DEMO;
    }
    function selectedRun() { return runCandidates().filter(function (inv) { return prSel[inv.id]; }); }
    function renderRunSum() {
      var list = selectedRun();
      var total = r2(list.reduce(function (s, inv) { return s + (core.remaining(inv) || 0); }, 0));
      $('pr-sum').textContent = list.length ? core.plural(list.length, 'payment', 'payments') + ' · ' + core.money(total) + ' on ' + core.dateStr($('pr-date').value) : 'Select the invoices to pay.';
      $('pr-go').disabled = !list.length;
    }
    function renderHistory() {
      var ul = $('pr-hist');
      ul.textContent = '';
      payRuns().slice(0, 12).forEach(function (r) {
        var still = (r.invoiceIds || []).map(byId).filter(function (x) { return x && !x.paid && x.payRun && x.payRun.id === r.id; });
        ul.append(el('li', {}, [
          el('span', { class: 'pr-main' }, [el('strong', { text: core.dateStr(r.createdAt.slice(0, 10)) + ' · ' + core.plural(r.count, 'payment', 'payments') + ' · ' + core.money(r.total) }),
            el('span', { class: 'muted', text: 'Pay on ' + core.dateStr(r.execDate) + ' · ' + (r.company || '') + ' · ' + (still.length ? still.length + ' not paid yet' : 'all paid') + ' · ' + r.msgId })]),
          r.xml ? el('button', { type: 'button', class: 'btn small', text: 'Download again', onclick: function () { core.saveBlob(new Blob([r.xml], { type: 'application/xml' }), fileName(r)); } }) : null,
          still.length ? el('button', { type: 'button', class: 'btn small ghost', text: 'Not sent', title: 'The bank did not take this file: the invoices go back to the pay run', onclick: function () { undoRun(r); } }) : null
        ]));
      });
      $('pr-hist-wrap').hidden = !payRuns().length;
    }
    function fileName(r) { return 'placila_' + r.execDate + '_' + r.msgId + '.xml'; }
    async function undoRun(r) {
      var list = (r.invoiceIds || []).map(byId).filter(function (x) { return x && !x.paid && x.payRun && x.payRun.id === r.id; });
      if (!window.confirm('Mark ' + core.plural(list.length, 'invoice', 'invoices') + ' of this pay run as not sent to the bank?')) return;
      for (var i = 0; i < list.length; i++) { delete list[i].payRun; list[i].updatedAt = new Date().toISOString(); await core.idb.put('invoices', list[i]); }
      r.undone = core.todayIso();
      await core.saveSettings();
      core.render();
      renderRun(false);
      core.toast(core.plural(list.length, 'invoice', 'invoices') + ' back in the pay run.');
    }
    async function downloadRun() {
      var list = selectedRun();
      var co = core.companyById($('pr-company').value);
      var iban = $('pr-iban').value.replace(/\s/g, '').toUpperCase();
      var bic = $('pr-bic').value.replace(/\s/g, '').toUpperCase();
      var run = { msgId: (core.DEMO ? 'SAMPLE' : '') + B.msgId(), createdAt: new Date().toISOString(), execDate: $('pr-date').value, debtor: { name: co ? co.name : '', iban: iban, bic: bic }, payments: list.map(paymentOf) };
      var res = B.buildPain001(run, { sampleIban: sampleOk() });
      var box = $('pr-errors');
      box.textContent = '';
      if (!res.ok) {
        res.errors.forEach(function (e) {
          var inv = byId(e.id);
          box.append(el('p', { text: (inv ? (inv.vendor || inv.fileName) + ' ' + (inv.number || '') + ': ' : e.id === 'debtor' ? 'Your account: ' : '') + e.messages.join('; ') + '.' }));
        });
        box.hidden = false;
        if (!co) box.prepend(el('p', { text: 'Pick the company that pays (its account goes in the file).' }));
        return;
      }
      box.hidden = true;
      var id = core.uid();
      var day = core.todayIso();
      var rec = { id: id, msgId: res.msgId, createdAt: run.createdAt, execDate: run.execDate, companyId: co.id, company: core.companyLabel(co.id), count: res.count, total: res.total, invoiceIds: list.map(function (x) { return x.id; }), xml: res.xml.length < 200000 ? res.xml : '' };
      core.saveBlob(new Blob([res.xml], { type: 'application/xml' }), fileName(rec));
      try {
        // your account goes into the company, so the next run is prefilled
        if (co.iban !== iban || (co.bic || '') !== bic) { co.iban = iban; co.bic = bic; }
        payRuns().unshift(rec);
        if (payRuns().length > 50) payRuns().length = 50;
        for (var i = 0; i < list.length; i++) {
          var inv = list[i];
          inv.payRun = { id: id, date: day, execDate: run.execDate, endToEnd: B.sepaText(inv.number || '', 35) || '' };
          inv.updatedAt = new Date().toISOString();
          await core.idb.put('invoices', inv);
        }
        await core.saveSettings();
      } catch (e) { core.toast('The file was made, but marking the invoices failed: ' + e.message); return; }
      $('payrun').close();
      core.render();
      core.toast(core.plural(list.length, 'payment', 'payments') + ' (' + core.money(res.total) + ') in ' + fileName(rec) + '. Upload it in your online bank; the invoices are marked "sent to bank".', { ms: 9000, action: { label: 'Undo', run: function () { undoRun(rec); } } });
    }

    // ---------- bank statement → paid ----------

    var imp = { txs: [], matches: [], rows: [] };
    function openStatement() {
      $('bi-status').textContent = '';
      $('bi-body').textContent = '';
      $('bi-go').disabled = true;
      $('bi-sample').hidden = !core.DEMO;
      imp = { txs: [], matches: [], rows: [] };
      $('bankimp').showModal();
    }
    function openList() {
      return st.invoices.filter(function (inv) { return !inv.paid && !core.isCredit(inv) && core.isEur(inv) && core.remaining(inv) > 0; }).map(function (inv) {
        return { id: inv.id, vendor: inv.vendor, number: inv.number, reference: inv.reference, iban: inv.iban, open: core.remaining(inv), total: inv.total, endToEnd: inv.payRun ? inv.payRun.endToEnd : '' };
      });
    }
    function bankKey(t) { return [t.id, t.date, t.amount.toFixed(2)].join('|'); }
    function knownKeys() {
      var k = {};
      st.invoices.forEach(function (inv) { (inv.payments || []).forEach(function (p) { if (p.bankRef) k[p.bankRef] = inv; }); });
      return k;
    }
    async function readStatement(file) {
      try {
        var text = await file.text();
        statementText(text, file.name);
      } catch (e) { $('bi-status').textContent = 'Could not read ' + file.name + ': ' + e.message + '.'; }
    }
    function statementText(text, name) {
      var res;
      try {
        res = /^\s*(<\?xml|<)/.test(text.replace(/^﻿/, '')) ? B.parseCamt(text) : B.parseBankCsv(text);
      } catch (e) {
        $('bi-status').textContent = 'This is not a bank statement this app can read (' + e.message + '). Use camt.053 (XML) from your online bank, or a CSV export.';
        return;
      }
      var known = knownKeys();
      var fresh = res.transactions.filter(function (t) { return !known[bankKey(t)]; });
      var dupes = res.transactions.length - fresh.length;
      var m = B.matchPayments(fresh, openList());
      imp = { txs: fresh, matches: m.matches, unmatched: m.unmatched, name: name };
      var outN = fresh.filter(function (t) { return t.direction === 'out'; }).length;
      $('bi-status').textContent = (name ? name + ': ' : '') + core.plural(res.transactions.length, 'entry', 'entries') + ' · ' + core.plural(outN, 'payment', 'payments') + ' out' +
        (m.incoming ? ' · ' + m.incoming + ' incoming (ignored: supplier invoices only)' : '') + (dupes ? ' · ' + dupes + ' already recorded' : '') + ' · ' + core.plural(m.matches.length, 'match', 'matches') + '.';
      renderMatches();
    }
    function renderMatches() {
      var body = $('bi-body');
      body.textContent = '';
      var open = openList();
      imp.rows = [];
      var rows = imp.matches.map(function (mt) { return { tx: mt.tx, invoiceId: mt.invoiceId, level: mt.level, why: mt.why, on: mt.level !== 'possible' }; })
        .concat((imp.unmatched || []).map(function (t) { return { tx: t, invoiceId: '', level: '', why: 'no open invoice matches', on: false }; }));
      if (!rows.length) { body.append(el('p', { class: 'empty-note', text: 'No outgoing payments in this statement.' })); $('bi-go').disabled = true; return; }
      var ul = el('ul', { class: 'bi-list' });
      rows.forEach(function (row) {
        var t = row.tx;
        var sel = el('select', { 'aria-label': 'Invoice paid by the payment of ' + core.money(t.amount) + ' to ' + (t.name || 'unknown') });
        core.setOptions(sel, [['', '— not an invoice here —']].concat(open.map(function (o) { return [o.id, (o.vendor || '?') + ' ' + (o.number || '') + ' · ' + core.money(o.open)]; })), row.invoiceId);
        var cb = el('input', { type: 'checkbox', 'aria-label': 'Record this payment', checked: row.on && row.invoiceId ? true : null });
        sel.addEventListener('change', function () { row.invoiceId = sel.value; cb.checked = !!sel.value; row.on = cb.checked; count(); });
        cb.addEventListener('change', function () { row.on = cb.checked && !!sel.value; if (cb.checked && !sel.value) { cb.checked = false; sel.focus(); } count(); });
        var lvl = row.level ? el('span', { class: 'pill ' + (row.level === 'exact' ? 'ok' : row.level === 'possible' ? 'warn' : 'part'), text: LEVEL_TEXT[row.level], title: row.why }) : el('span', { class: 'pill', text: 'No match' });
        ul.append(el('li', {}, [
          el('label', { class: 'pr-pick' }, [cb]),
          el('div', { class: 'pr-main' }, [
            el('span', { class: 'pr-v' }, [el('strong', { class: 'num', text: core.money(t.amount) }), ' ', el('span', { text: t.name || '(no name)' }), ' ', el('span', { class: 'muted num', text: core.dateStr(t.date) })]),
            el('span', { class: 'pr-m muted', text: [t.reference, t.endToEnd ? 'E2E ' + t.endToEnd : '', t.text].filter(Boolean).join(' · ').slice(0, 160) || '–' }),
            el('span', { class: 'bi-to' }, [lvl, sel]),
            row.why && row.level ? el('span', { class: 'pr-m muted', text: row.why }) : null
          ])
        ]));
        imp.rows.push(row);
      });
      body.append(ul);
      count();
    }
    function count() {
      var n = imp.rows.filter(function (r) { return r.on && r.invoiceId; }).length;
      $('bi-go').disabled = !n;
      $('bi-go').textContent = n ? 'Record ' + core.plural(n, 'payment', 'payments') : 'Record payments';
    }
    async function applyStatement() {
      var rows = imp.rows.filter(function (r) { return r.on && r.invoiceId; });
      var used = {};
      var paidN = 0;
      var partN = 0;
      try {
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          var inv = byId(r.invoiceId);
          if (!inv || inv.paid) continue;
          if (used[inv.id] && core.remaining(inv) <= 0) continue;
          used[inv.id] = true;
          inv.payments = (inv.payments || []).concat([{ id: core.uid(), date: r.tx.date, amount: r2(r.tx.amount), method: 'Bank transfer', note: ('Bank statement' + (r.tx.reference ? ' · ' + r.tx.reference : '') + (imp.name ? ' · ' + imp.name : '')).slice(0, 200), bankRef: bankKey(r.tx).slice(0, 120) }]);
          if (core.paidAmount(inv) >= (inv.total || 0) - 0.005) { inv.paid = true; inv.paidDate = r.tx.date; paidN++; } else partN++;
          inv.updatedAt = new Date().toISOString();
          await core.idb.put('invoices', inv);
        }
      } catch (e) { core.toast('Could not save: ' + e.message); return; }
      $('bankimp').close();
      core.render();
      core.toast((paidN ? core.plural(paidN, 'invoice', 'invoices') + ' marked paid' : '') + (paidN && partN ? ' · ' : '') + (partN ? core.plural(partN, 'part payment', 'part payments') + ' recorded' : '') + (paidN || partN ? '.' : 'Nothing recorded.'));
    }

    // ---------- e-invoice (XML) preview ----------

    // UN/ECE Rec. 20 unit codes used in e-invoices
    var UNITS = { C62: 'pcs', H87: 'pcs', EA: 'pcs', HUR: 'h', DAY: 'd', MON: 'mo', ANN: 'yr', KWH: 'kWh', KGM: 'kg', LTR: 'l', MTR: 'm', MTK: 'm²', MTQ: 'm³', SET: 'set', PR: 'pair', KMT: 'km', TNE: 't', MIN: 'min', WEE: 'wk', E48: 'unit' };
    function partyBlock(title, p) {
      return el('div', { class: 'xp-party' }, [el('span', { class: 'eyebrow', text: title }), el('strong', { text: p.name || '–' }),
        el('span', { text: [p.street, [p.postCode, p.city].filter(Boolean).join(' '), p.country].filter(Boolean).join(', ') }),
        p.vatId ? el('span', { class: 'mono', text: 'VAT ID ' + p.vatId }) : null, p.email ? el('span', { text: p.email }) : null]);
    }
    async function renderXml(inv, holder, alive) {
      var text;
      var e;
      try {
        var blob = await core.fileBlob(inv, function (m) { if (alive()) holder.append(el('p', { class: 'more loading', role: 'status' }, [el('span', { class: 'spin', 'aria-hidden': 'true' }), m])); });
        text = await blob.text();
        e = E.read(text);
      } catch (err) {
        if (!alive()) return;
        holder.textContent = '';
        holder.append(el('p', { class: 'more', text: /not stored|cloud/i.test(err.message || '') ? 'The file of this invoice is not in this browser. Sign in to cloud sync (Settings) to download it.' : 'The e-invoice could not be read (' + err.message + '). You can still download the file.' }));
        return;
      }
      if (!alive()) return;
      holder.textContent = '';
      var cur = e.currency;
      var m = function (v) { return v == null ? '–' : core.money(e.docType === 'credit' ? -Math.abs(v) : v, cur); };
      var card = el('article', { class: 'xp', 'aria-label': 'E-invoice ' + e.number });
      card.append(el('header', { class: 'xp-head' }, [
        el('div', {}, [el('span', { class: 'eyebrow', text: (e.docType === 'credit' ? 'CREDIT NOTE' : 'INVOICE') + ' · ' + e.format + ' E-INVOICE' }), el('h3', { text: e.number || '(no number)' })]),
        el('dl', { class: 'xp-dates' }, [el('dt', { text: 'Issued' }), el('dd', { text: core.dateStr(e.issueDate) }), el('dt', { text: 'Due' }), el('dd', { text: core.dateStr(e.dueDate) }),
          el('dt', { text: 'Delivery' }), el('dd', { text: e.periodFrom && e.periodTo ? core.dateStr(e.periodFrom) + ' – ' + core.dateStr(e.periodTo) : core.dateStr(e.serviceDate) })])
      ]));
      card.append(el('div', { class: 'xp-parties' }, [partyBlock('SELLER', e.seller), partyBlock('BUYER', e.buyer)]));
      e.warnings.forEach(function (w) { card.append(el('div', { class: 'alert warn' }, [core.icon('alert'), el('span', { text: w })])); });
      var tb = el('tbody');
      e.items.forEach(function (it) { tb.append(el('tr', {}, [el('td', { text: it.name }), el('td', { class: 'r num', text: it.qty != null ? String(it.qty).replace('.', ',') + ' ' + (UNITS[it.unit] || it.unit || '') : '' }), el('td', { class: 'r num', text: m(it.net) })])); });
      if (e.items.length) card.append(el('div', { class: 'xp-scroll' }, [el('table', { class: 'xp-lines' }, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Item' }), el('th', { class: 'r', text: 'Qty' }), el('th', { class: 'r', text: 'Net' })])]), tb])]));
      var tot = el('dl', { class: 'xp-tot' });
      e.vatBreakdown.forEach(function (b) { tot.append(el('dt', { text: 'VAT ' + (b.rate != null ? String(b.rate).replace('.', ',') + ' %' : '') + (b.category && b.category !== 'S' ? ' (' + b.category + ')' : '') + ' on ' + m(b.base) }), el('dd', { class: 'num', text: m(b.vat) })); });
      tot.append(el('dt', { text: 'Net' }), el('dd', { class: 'num', text: m(e.net) }), el('dt', { text: 'VAT' }), el('dd', { class: 'num', text: m(e.vat) }), el('dt', { class: 'big', text: 'Total' }), el('dd', { class: 'num big', text: m(e.total) }));
      if (e.prepaid) tot.append(el('dt', { text: 'Prepaid' }), el('dd', { class: 'num', text: m(e.prepaid) }));
      if (e.payable != null && e.payable !== e.total) tot.append(el('dt', { text: 'To pay' }), el('dd', { class: 'num', text: m(e.payable) }));
      card.append(tot);
      if (e.iban || e.reference) card.append(el('p', { class: 'xp-pay mono', text: [e.iban ? 'IBAN ' + core.formatIban(e.iban) : '', e.bic ? 'BIC ' + e.bic : '', e.reference ? 'Ref. ' + e.reference : ''].filter(Boolean).join('   ') }));
      e.notes.forEach(function (n) { card.append(el('p', { class: 'xp-note', text: n })); });
      if (e.attachments.length) {
        var acts = el('div', { class: 'xp-att' });
        e.attachments.forEach(function (a) {
          acts.append(el('button', { type: 'button', class: 'btn small', text: 'Open ' + (a.name || 'attachment') + (a.size ? ' (' + Math.max(1, Math.round(a.size / 1024)) + ' KB)' : ''), onclick: function () {
            var at = E.attachment(text, a.index);
            if (!at) return;
            var b = new Blob([at.bytes], { type: at.mime });
            if (/^(application\/pdf|image\/)/.test(at.mime)) { var u = URL.createObjectURL(b); window.open(u, '_blank', 'noopener'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); }
            else core.saveBlob(b, at.name);
          } }));
        });
        card.append(el('div', {}, [el('span', { class: 'eyebrow', text: 'ATTACHED TO THE E-INVOICE' }), acts]));
      }
      var raw = el('details', { class: 'text' }, [el('summary', { text: 'Show the XML' })]);
      raw.addEventListener('toggle', function () { if (raw.open && !raw.querySelector('pre')) raw.append(el('pre', { text: text.length > 60000 ? text.slice(0, 60000) + '\n…' : text })); }, { once: false });
      card.append(raw);
      holder.append(card);
    }

    // e-invoice → the same shape parser.js returns, so makeInvoice() treats both alike
    function toParsed(e, opts) {
      var P = window.InvoiceParser;
      var lines = ['Kupec: ' + e.buyer.name, e.buyer.street, [e.buyer.postCode, e.buyer.city].filter(Boolean).join(' '), e.buyer.vatId ? 'ID za DDV: ' + e.buyer.vatId : '', e.buyer.email].filter(Boolean);
      var billed = P.findBilledTo(lines, opts.companies || []);
      var person = e.buyer.email ? P.findBilledPerson(lines, { users: opts.users, vendor: e.seller.name, companies: opts.companies }) : { email: '', conf: 'none' };
      var rule = (e.seller.vatId && opts.rules && opts.rules['id:' + e.seller.vatId]) || null;
      var credit = e.docType === 'credit';
      var neg = function (v) { return v == null ? v : credit ? -Math.abs(v) : v; };
      return {
        vendor: rule ? rule.vendor : e.seller.name, vendorTaxId: e.seller.vatId || '', billedTo: billed.id || '', billedPerson: person.email || '', billedPersonName: person.name || '',
        number: e.number, issueDate: e.issueDate, dueDate: e.dueDate, currency: e.currency || 'EUR', docType: credit ? 'credit' : 'invoice',
        total: neg(e.total), vat: neg(e.vat), net: neg(e.net), vatRate: e.vatRate, serviceDate: e.serviceDate, iban: e.iban, bic: e.bic, reference: e.reference.replace(/\s+/g, ''), poNumber: e.poNumber,
        category: (rule && rule.category) || P.guessCategory(e.seller.name, e.items.map(function (i) { return i.name; }).join('\n'), null), reverseCharge: e.reverseCharge,
        scanned: false, prepaid: e.prepaid,
        einvoice: { format: e.format, warnings: e.warnings.slice(0, 10), payable: e.payable, prepaid: e.prepaid, attachments: e.attachments.map(function (a) { return { name: a.name, mime: a.mime, size: a.size }; }).slice(0, 10) },
        confidence: { vendor: rule ? 'high' : 'high', number: e.number ? 'high' : 'none', issueDate: e.issueDate ? 'high' : 'none', dueDate: e.dueDate ? 'high' : 'none', total: e.total != null ? 'high' : 'none', vat: e.vat != null ? 'high' : 'none', net: e.net != null ? 'high' : 'none', billedTo: billed.conf, billedPerson: person.email ? person.conf : 'xml', docType: 'high' }
      };
    }

    // ---------- demo with sample invoices ----------

    async function loadSamples() {
      var list = S.build(core.todayIso());
      var t = core.toast('Adding sample invoices…', { progress: true });
      try {
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (byId(o.inv.id)) continue;
          await core.idb.put('files', { id: o.inv.id, blob: new Blob([o.bytes], { type: o.mime }), hash: o.inv.hash, type: o.mime });
          await core.idb.put('invoices', o.inv);
          st.invoices.push(o.inv);
        }
        var co = core.companyById('stratum') || core.companies()[0];
        if (co) { co.vatId = co.vatId || S.BUYER.vatId; co.iban = co.iban || 'SI00020100000000019'; co.bic = co.bic || 'LJBASI2X'; }
        if (!core.users().some(function (u) { return u.email === S.BUYER.email; })) core.users().push({ email: S.BUYER.email, name: 'Nabava', companyId: co ? co.id : '', aliases: [], isNew: false });
        if (approvers().indexOf('Maja Kos') === -1) approvers().push('Maja Kos');
        settings().lastApprover = settings().lastApprover || 'Maja Kos';
        await core.saveSettings();
      } catch (e) { t.close(); core.toast('Could not add the samples: ' + e.message); return; }
      t.close();
      st.filters.year = '';
      st.filters.month = '';
      core.render();
      core.toast(core.plural(list.length, 'sample invoice', 'sample invoices') + ' added (demo storage only).');
    }
    async function removeSamples() {
      if (!window.confirm('Remove the demo: every sample invoice and anything you added in the demo is deleted from this device. Your own invoices are not touched.')) return;
      try { await Promise.all(['files', 'invoices', 'kv', 'templates'].map(function (s) { return core.idb.clear(s); })); } catch (e) { /* the page reloads anyway */ }
      try { localStorage.removeItem(core.UI_KEY); } catch (e) { /* ignore */ }
      location.href = location.pathname;
    }
    function renderDemo() {
      $('demo-banner').hidden = !core.DEMO;
      if (!core.DEMO) return;
      var n = st.invoices.filter(function (x) { return x.sample; }).length;
      $('demo-text').textContent = 'Demo with ' + core.plural(n, 'sample invoice', 'sample invoices') + '. They are kept apart from your own invoices on this device and never go to your cloud copy.';
      $('demo-load').hidden = n > 0;
    }

    function showWaiting() {
      st.filters.status = 'approval';
      st.filters.year = '';
      st.filters.month = '';
      core.saveUi();
      core.render();
      var h = $('t-h');
      if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---------- events ----------

    $('appr-ok').addEventListener('click', function () { decide('approved'); });
    $('appr-no').addEventListener('click', function () { decide('rejected'); });
    $('appr-reset').addEventListener('click', function () { decide('pending'); });
    var menu = $('pay-menu');
    menu.querySelectorAll('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        menu.removeAttribute('open');
        var a = b.dataset.pay;
        if (a === 'approval') showWaiting();
        else if (a === 'run') openRun();
        else if (a === 'statement') openStatement();
      });
    });
    document.addEventListener('click', function (e) { if (menu.open && !menu.contains(e.target)) menu.removeAttribute('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.open) { menu.removeAttribute('open'); menu.querySelector('summary').focus(); } });
    $('pr-company').addEventListener('change', function () { prSel = {}; fillDebtor(); renderRun(true); });
    $('pr-sent').addEventListener('change', function () { renderRun(false); });
    $('pr-date').addEventListener('change', renderRunSum);
    $('pr-go').addEventListener('click', downloadRun);
    $('pr-close').addEventListener('click', function () { $('payrun').close(); });
    $('pr-cancel').addEventListener('click', function () { $('payrun').close(); });
    $('bi-close').addEventListener('click', function () { $('bankimp').close(); });
    $('bi-cancel').addEventListener('click', function () { $('bankimp').close(); });
    $('bi-pick').addEventListener('click', function () { $('bi-file').click(); });
    $('bi-file').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (f) readStatement(f); });
    $('bi-go').addEventListener('click', applyStatement);
    $('bi-sample').addEventListener('click', function () { statementText(S.statement(st.invoices, core.todayIso()), 'sample-statement.xml'); });
    $('pr-sample').addEventListener('click', function () { core.saveBlob(new Blob([S.statement(st.invoices, core.todayIso())], { type: 'application/xml' }), 'sample-camt053-' + core.todayIso() + '.xml'); });
    $('demo-remove').addEventListener('click', removeSamples);
    $('demo-load').addEventListener('click', loadSamples);
    $('sample-btn').addEventListener('click', function () { if (core.DEMO) loadSamples(); else location.href = location.pathname + '?demo=1'; });

    return {
      approvalOf: approvalOf, approvalOn: approvalOn, applyMode: applyMode, waiting: waiting, matches: matches, statusTags: statusTags, onOpen: onOpen, bulkApprove: bulkApprove,
      renderXml: renderXml, toParsed: toParsed, statementText: function (text, name) { openStatement(); statementText(text, name); },
      loadSamples: loadSamples, renderDemo: renderDemo, openRun: openRun, openStatement: openStatement
    };
  }

  window.InvoicePayFlow = { init: init };
})();
