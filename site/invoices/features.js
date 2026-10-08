/* Adrial Apps · Invoices — payments, reminders, payment QR codes, duplicate comparison and the
 * accountant export. Loaded before app.js; app.js calls InvoiceFeatures.init(core) with its helpers.
 * Everything stays in the browser: the ZIP is written by zip.js, QR codes by qr.js, no network.
 * PDF / user text only ever goes into the page through textContent (el()).
 */
(function () {
  'use strict';

  var METHODS = ['Bank transfer', 'Card', 'Cash', 'PayPal', 'Direct debit', 'Other'];
  var NOTIFY_KEY = 'adrial-invoices-notified';

  function init(core) {
    var $ = core.$;
    var el = core.el;
    var Q = window.InvoiceQR;
    var Z = window.InvoiceZip;
    var P = window.InvoiceParser;
    var pays = [];        // payments of the open invoice (saved with the invoice on Save)
    var current = null;
    var qrKind = 'upn';

    function r2(n) { return Math.round(n * 100) / 100; }
    function sumPays(list) { return r2(list.reduce(function (s, p) { return s + (+p.amount || 0); }, 0)); }

    // ---------- payments in the invoice dialog ----------

    function onOpen(inv) {
      current = inv;
      pays = (inv.payments || []).map(function (p) { return Object.assign({}, p); });
      $('pay-date').value = core.todayIso();
      $('pay-amount').value = '';
      $('pay-note').value = '';
      $('pay-method').value = METHODS[0];
      $('d-payee-street').value = inv.payeeStreet || '';
      $('d-payee-city').value = inv.payeeCity || '';
      renderPays();
      renderQr();
    }

    function formTotal() { return core.parseAmount($('d-total').value); }

    function renderPays() {
      var ul = $('pay-list');
      ul.textContent = '';
      var cur = $('d-cur').value || 'EUR';
      pays.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; }).forEach(function (p) {
        ul.append(el('li', {}, [
          el('span', { class: 'num', text: core.dateStr(p.date) }),
          el('strong', { class: 'num', text: core.money(p.amount, cur) }),
          el('span', { class: 'muted', text: [p.method, p.note].filter(Boolean).join(' · ') }),
          el('button', { type: 'button', class: 'btn small ghost danger', text: 'Remove', 'aria-label': 'Remove the payment of ' + core.money(p.amount, cur) + ' on ' + core.dateStr(p.date), onclick: function () {
            pays = pays.filter(function (x) { return x !== p; });
            renderPays();
            renderQr();
            $('pay-amount').focus();
          } })
        ]));
      });
      var total = formTotal();
      var paid = sumPays(pays);
      var full = $('d-paid').checked;
      var open = total == null ? null : Math.max(0, r2(total - paid));
      var st = $('pay-state');
      st.className = 'pill ' + (full || (open === 0 && pays.length) ? 'ok' : paid > 0 ? 'part' : '');
      st.textContent = full || (open === 0 && pays.length) ? 'Paid' : paid > 0 ? 'Partially paid · ' + core.money(paid, cur) + ' of ' + core.money(total, cur) : 'Unpaid' + (open != null ? ' · ' + core.money(open, cur) + ' open' : '');
      $('pay-empty').hidden = pays.length > 0;
      $('pay-amount').placeholder = open ? core.amountText(open) : '0,00';
    }

    function addPayment() {
      var amount = core.parseAmount($('pay-amount').value);
      if (amount == null || !$('pay-amount').value.trim()) {
        var total = formTotal();
        amount = total != null ? Math.max(0, r2(total - sumPays(pays))) : null;
      }
      if (!(amount > 0)) { core.toast('Enter the amount that was paid.'); $('pay-amount').focus(); return; }
      var date = $('pay-date').value || core.todayIso();
      pays.push({ id: core.uid(), date: date, amount: r2(amount), method: $('pay-method').value, note: $('pay-note').value.trim().slice(0, 200) });
      $('pay-amount').value = '';
      $('pay-note').value = '';
      var t = formTotal();
      if (t != null && sumPays(pays) >= t - 0.005) {
        $('d-paid').checked = true;
        $('d-paid-date').value = date;
        $('d-paid').dispatchEvent(new Event('change', { bubbles: true }));
      }
      renderPays();
      renderQr();
      $('pay-live').textContent = 'Payment of ' + core.amountText(amount) + ' added. It is saved when you save the invoice.';
    }

    function collect(inv) {
      if (inv !== current) return;
      inv.payments = pays.map(function (p) { return { id: p.id, date: p.date, amount: p.amount, method: p.method || '', note: p.note || '' }; });
      inv.payeeStreet = $('d-payee-street').value.trim().slice(0, 70) || undefined;
      inv.payeeCity = $('d-payee-city').value.trim().slice(0, 70) || undefined;
    }

    // ---------- payment QR (UPN QR for Slovenian IBANs, EPC/SEPA "BCD" for the rest) ----------

    function renderQr() {
      var box = $('qr-box');
      var note = $('qr-note');
      var tabs = $('qr-tabs');
      box.textContent = '';
      var iban = $('d-iban').value.replace(/\s/g, '').toUpperCase();
      var cur = $('d-cur').value || 'EUR';
      var total = formTotal();
      var open = total == null ? null : Math.max(0, r2(total - sumPays(pays)));
      var paid = $('d-paid').checked || open === 0;
      $('qr-wrap').hidden = false;
      tabs.hidden = true;
      if (paid) { $('qr-wrap').hidden = true; return; }
      if (!iban || !P.ibanValid(iban)) { note.textContent = iban ? 'The IBAN does not look valid, so no payment QR code is shown.' : 'Add the vendor’s IBAN (in “payment & order details”) to get a QR code you can scan with your banking app.'; return; }
      if (!(open > 0)) { note.textContent = 'Enter the total to get a payment QR code.'; return; }
      if (cur !== 'EUR') { note.textContent = 'QR payment codes are for euro payments only.'; return; }
      var si = iban.slice(0, 2) === 'SI';
      if (!si) qrKind = 'epc';
      tabs.hidden = !si;
      tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.kind === qrKind ? 'true' : 'false'); });
      var vendor = $('d-vendor').value.trim();
      var number = $('d-number').value.trim();
      try {
        var out;
        if (qrKind === 'upn' && si) {
          out = Q.upnQr({
            iban: iban, amount: open, reference: $('d-ref').value, name: vendor, street: $('d-payee-street').value, city: $('d-payee-city').value,
            purpose: (number ? 'Račun ' + number : 'Plačilo računa'), purposeCode: 'OTHR', dueDate: $('d-due').value
          });
        } else {
          out = Q.epcQr({ iban: iban, amount: open, name: vendor || 'Payee', reference: $('d-ref').value, text: (number ? 'Invoice ' + number : 'Invoice payment') + ($('d-ref').value && !/^RF/i.test($('d-ref').value) ? ' ' + $('d-ref').value : '') });
        }
        // the SVG markup holds only numbers and an escaped title
        box.innerHTML = Q.svg(out.qr, { title: (qrKind === 'upn' && si ? 'UPN QR' : 'SEPA QR') + ' code to pay ' + core.money(open, 'EUR') + ' to ' + (vendor || iban) });
        note.textContent = '';
        note.append(el('strong', { text: 'Pay with your banking app: ' }),
          (qrKind === 'upn' && si ? 'choose “UPN QR” / “Scan” in your bank’s app and point it at the code. ' : 'scan this SEPA (EPC) QR code in your bank’s app. ') +
          core.money(open, 'EUR') + ' to ' + core.formatIban(iban) + ($('d-ref').value ? ' · ref. ' + $('d-ref').value : '') + '. Your own account is not in the code — the app fills it in.');
        if (qrKind === 'upn' && si && (!$('d-payee-street').value.trim() || !$('d-payee-city').value.trim())) note.append(el('span', { class: 'muted', text: ' Some banks also want the vendor’s address: add it below.' }));
      } catch (e) {
        note.textContent = 'No QR code: ' + e.message + '.';
      }
    }

    // ---------- dashboard: ageing, unpaid by company / person, due soon ----------

    function bars(ul, groups, onPick) {
      ul.textContent = '';
      var max = groups.reduce(function (m, g) { return Math.max(m, g.total); }, 0) || 1;
      if (!groups.length) { ul.append(el('li', {}, [el('p', { class: 'empty-note', text: 'Nothing unpaid here.' })])); return; }
      groups.forEach(function (g) {
        var label = g.name + ': ' + core.money(g.total) + ', ' + core.plural(g.count, 'invoice', 'invoices');
        var inner = [
          el('span', { class: 'name', text: g.name }),
          el('span', { class: 'track' }, [el('span', { class: 'fill' + (g.bad ? ' bad' : ''), style: 'display:block;width:' + Math.max(g.total ? 1.5 : 0, (g.total / max) * 100) + '%' })]),
          el('span', { class: 'val num' }, [core.money(g.total), el('small', { text: core.plural(g.count, 'invoice', 'invoices') })])
        ];
        ul.append(el('li', {}, [onPick ? el('button', { type: 'button', class: 'hbar', 'aria-label': label, onclick: function () { onPick(g); } }, inner) : el('div', { class: 'hbar static', 'aria-label': label, role: 'group' }, inner)]));
      });
    }

    function ageing(list) {
      var today = core.todayIso();
      var B = [
        { key: 'nd', name: 'Not due yet', total: 0, count: 0 },
        { key: 'a', name: '1–30 days overdue', total: 0, count: 0, bad: true },
        { key: 'b', name: '31–60 days overdue', total: 0, count: 0, bad: true },
        { key: 'c', name: '61–90 days overdue', total: 0, count: 0, bad: true },
        { key: 'd', name: 'Over 90 days overdue', total: 0, count: 0, bad: true }
      ];
      list.forEach(function (inv) {
        if (inv.paid) return;
        var v = core.remainingEur(inv);
        if (!v) return;
        var days = inv.dueDate ? Math.round((new Date(today + 'T00:00:00Z') - new Date(inv.dueDate + 'T00:00:00Z')) / 86400000) : 0;
        var b = days <= 0 ? B[0] : days <= 30 ? B[1] : days <= 60 ? B[2] : days <= 90 ? B[3] : B[4];
        b.total += v;
        b.count++;
      });
      return B;
    }

    function unpaidBy(list, keyOf, nameOf) {
      var map = {};
      list.forEach(function (inv) {
        if (inv.paid) return;
        var v = core.remainingEur(inv);
        if (!v) return;
        var k = keyOf(inv);
        if (!map[k]) map[k] = { id: k, name: nameOf(k), total: 0, count: 0 };
        map[k].total += v;
        map[k].count++;
      });
      return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.total - a.total; });
    }

    function renderPayments(list) {
      var st = core.state;
      bars($('pay-ageing'), ageing(list));
      bars($('pay-co'), unpaidBy(list, function (inv) { return core.companyById(inv.billedTo) ? inv.billedTo : core.UNASSIGNED; }, function (k) { return k === core.UNASSIGNED ? 'Unassigned' : core.companyLabel(k); }), function (g) {
        st.filters.company = g.id; st.filters.status = 'unpaid'; core.render();
      });
      bars($('pay-person'), unpaidBy(list, core.personKey, function (k) { return k === core.UNASSIGNED ? 'Unassigned' : core.personLabel(k); }), function (g) {
        st.filters.person = g.id; st.filters.status = 'unpaid'; core.render();
      });
      var due = st.invoices.filter(function (x) { return core.isDueSoon(x) || core.isOverdue(x); }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
      var ul = $('pay-due');
      ul.textContent = '';
      $('pay-due-h').textContent = 'Due within ' + core.plural(core.remindDays(), 'day', 'days') + ' & overdue';
      if (!due.length) ul.append(el('li', {}, [el('p', { class: 'empty-note', text: 'Nothing due soon.' })]));
      due.slice(0, 8).forEach(function (inv) {
        var over = core.isOverdue(inv);
        ul.append(el('li', {}, [el('button', { type: 'button', class: 'due-item', onclick: function () { core.openDetail(inv.id, []); } }, [
          el('span', { class: 'v', text: inv.vendor || inv.fileName }),
          el('span', { class: 'pill ' + (over ? 'bad' : 'warn'), text: (over ? 'Overdue since ' : 'Due ') + core.dateStr(inv.dueDate) }),
          el('span', { class: 'num', text: inv.currency && inv.currency !== 'EUR' ? core.money(core.remaining(inv), inv.currency) : core.money(core.remaining(inv)) })
        ])]));
      });
      if (due.length > 8) ul.append(el('li', {}, [el('p', { class: 'muted', style: 'margin:6px 8px 0;font-size:13px', text: '+ ' + (due.length - 8) + ' more — use the “Due soon” or “Overdue” status filter' })]));
      var open = list.filter(function (x) { return !x.paid; });
      $('pay-note').textContent = core.plural(open.length, 'unpaid invoice', 'unpaid invoices') + ' · ' + core.money(core.sum(open, core.remainingEur)) + ' open';
    }

    // ---------- reminders: browser notifications (only while the app is open) ----------

    function enableNotify(cb) {
      if (!window.Notification) { cb.checked = false; return; }
      Notification.requestPermission().then(function (p) {
        if (p !== 'granted') {
          cb.checked = false;
          $('s-notify-hint').textContent = p === 'denied' ? 'Notifications are blocked for this site in the browser settings.' : 'Permission was not given.';
        } else $('s-notify-hint').textContent = 'You will get a notification when an invoice is due soon, while the app is open.';
      });
    }

    function maybeNotify(soon, late) {
      var s = core.state.settings;
      if (!s.notify || !window.Notification || Notification.permission !== 'granted') return;
      var today = core.todayIso();
      var log;
      try { log = JSON.parse(localStorage.getItem(NOTIFY_KEY) || 'null'); } catch (e) { log = null; }
      if (!log || log.date !== today) log = { date: today, ids: [] };
      soon.concat(late).forEach(function (inv) {
        if (log.ids.indexOf(inv.id) !== -1) return;
        log.ids.push(inv.id);
        try {
          var n = new Notification((core.isOverdue(inv) ? 'Overdue: ' : 'Due ' + core.dateStr(inv.dueDate) + ': ') + (inv.vendor || inv.fileName), {
            body: core.money(core.remaining(inv), inv.currency || 'EUR') + (inv.number ? ' · ' + inv.number : ''), tag: 'adrial-invoice-' + inv.id
          });
          n.onclick = function () { window.focus(); core.openDetail(inv.id, []); n.close(); };
        } catch (e) { /* some browsers only allow notifications from a service worker */ }
      });
      try { localStorage.setItem(NOTIFY_KEY, JSON.stringify({ date: log.date, ids: log.ids.slice(-200) })); } catch (e) { /* ignore */ }
    }
    setInterval(function () {
      var inv = core.state.invoices;
      maybeNotify(inv.filter(core.isDueSoon), inv.filter(core.isOverdue));
    }, 60 * 60 * 1000);

    // ---------- calendar (.ics) of due dates ----------

    function icsText(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
    function fold(line) {
      var out = [];
      var bytes = new TextEncoder().encode(line);
      if (bytes.length <= 75) return line;
      var cur = '';
      Array.from(line).forEach(function (ch) {
        if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
        cur += ch;
      });
      out.push(cur);
      return out.join('\r\n ');
    }
    function exportIcs() {
      var list = core.state.invoices.filter(function (x) { return !x.paid && x.dueDate; });
      if (!list.length) { core.toast('No unpaid invoices with a due date.'); return; }
      var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Adrial Apps//Invoices//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Invoices due'];
      list.forEach(function (inv) {
        var d = inv.dueDate.replace(/-/g, '');
        var next = core.addDays(inv.dueDate, 1).replace(/-/g, '');
        var amount = core.money(core.remaining(inv), inv.currency || 'EUR');
        lines.push('BEGIN:VEVENT', 'UID:' + inv.id + '@adrial-invoices', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + next,
          'SUMMARY:' + icsText('Pay ' + (inv.vendor || inv.fileName) + ' · ' + amount),
          'DESCRIPTION:' + icsText([inv.number ? 'Invoice ' + inv.number : '', inv.iban ? 'IBAN ' + core.formatIban(inv.iban) : '', inv.reference ? 'Reference ' + inv.reference : '', core.companyById(inv.billedTo) ? 'Billed to ' + core.companyLabel(inv.billedTo) : ''].filter(Boolean).join('\n')),
          'TRANSP:TRANSPARENT',
          'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText('Invoice due: ' + (inv.vendor || inv.fileName)), 'TRIGGER:-P' + core.remindDays() + 'D', 'END:VALARM',
          'END:VEVENT');
      });
      lines.push('END:VCALENDAR');
      core.saveBlob(new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }), 'invoices-due-' + core.todayIso() + '.ics');
      core.toast('Calendar with ' + core.plural(list.length, 'due date', 'due dates') + ' downloaded. Reminders are set ' + core.plural(core.remindDays(), 'day', 'days') + ' before.');
    }

    // ---------- duplicates: side by side ----------

    var LEVEL_TEXT = { file: 'The same file', duplicate: 'Same vendor and invoice number', likely: 'Same vendor, total and date — likely a duplicate', possible: 'Same total, date and company — possibly a duplicate' };

    function rows(inv) {
      return [
        ['Vendor', inv.vendor || '–'], ['VAT ID', inv.vendorTaxId || '–'], ['Number', inv.number || '–'], ['Date', core.dateStr(inv.issueDate)],
        ['Total', inv.total != null ? core.money(inv.total, inv.currency || 'EUR') : '–'], ['Billed to', core.companyById(inv.billedTo) ? core.companyLabel(inv.billedTo) : 'Unassigned'],
        ['Status', core.STATUS_LABEL[core.statusOf(inv)]], ['File', inv.fileName || '–'], ['Added', core.dateStr(String(inv.addedAt || '').slice(0, 10))]
      ];
    }

    async function thumb(holder, inv) {
      var doc = null;
      try {
        doc = await core.openDoc(inv);
        var page = await doc.getPage(1);
        var base = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: Math.min(2, 560 / base.width) });
        var c = el('canvas', { role: 'img', 'aria-label': 'First page of ' + (inv.vendor || inv.fileName) });
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        holder.textContent = '';
        holder.append(c);
      } catch (e) {
        holder.textContent = 'No preview (' + e.message + ').';
      } finally {
        if (doc) { try { doc.destroy(); } catch (e2) { /* ignore */ } }
      }
    }

    function compareDuplicates(inv, d, mode) {
      var dlg = $('dup');
      var other = d.other;
      $('dup-why').textContent = LEVEL_TEXT[d.level] || d.why;
      var cols = $('dup-cols');
      cols.textContent = '';
      [[inv, mode === 'upload' ? 'New upload' : 'This invoice'], [other, 'Already saved']].forEach(function (pair) {
        var x = pair[0];
        var dl = el('dl', {});
        rows(x).forEach(function (r) {
          var other2 = x === inv ? other : inv;
          var same = rows(other2).find(function (q) { return q[0] === r[0]; });
          dl.append(el('dt', { text: r[0] }), el('dd', { class: same && same[1] === r[1] && r[0] !== 'Added' && r[0] !== 'Status' ? 'same' : '', text: r[1] }));
        });
        var pv = el('div', { class: 'dup-thumb', text: 'Loading preview…' });
        cols.append(el('section', { class: 'dup-col', 'aria-label': pair[1] }, [el('h3', { text: pair[1] }), pv, dl]));
        thumb(pv, x);
      });
      var b = function (id, text) { $(id).textContent = text; };
      if (mode === 'upload') { b('dup-keep', 'Keep both'); b('dup-replace', 'Replace the saved one'); b('dup-discard', 'Discard the new one'); }
      else { b('dup-keep', 'Keep both'); b('dup-replace', 'Delete the other one'); b('dup-discard', 'Delete this one'); }
      return new Promise(function (resolve) {
        var done = false;
        function finish(v) {
          if (done) return;
          done = true;
          ['dup-keep', 'dup-replace', 'dup-discard', 'dup-close'].forEach(function (id) { $(id).onclick = null; });
          dlg.removeEventListener('close', onClose);
          if (dlg.open) dlg.close();
          resolve(v);
        }
        function onClose() { finish(null); }
        $('dup-keep').onclick = function () { finish('keep'); };
        $('dup-replace').onclick = function () { if (mode === 'upload' || window.confirm('Delete the other invoice (' + (other.vendor || other.fileName) + ')?')) finish('replace'); };
        $('dup-discard').onclick = function () { if (mode === 'upload' || window.confirm('Delete this invoice?')) finish('discard'); };
        $('dup-close').onclick = function () { finish(null); };
        dlg.addEventListener('close', onClose);
        dlg.showModal();
        $('dup-keep').focus();
      });
    }

    // ---------- accountant export: one company, one month or a range ----------

    var TOKENS = ['date', 'vendor', 'number', 'company', 'person', 'category', 'total'];
    function safePart(s) {
      return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[łŁ]/g, 'l')
        .replace(/[\\/:*?"<>|#%&{}$!'@+`=]+/g, '-').replace(/\s+/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
    }
    function fileNameFor(inv, pattern) {
      var co = core.companyById(inv.billedTo);
      var map = {
        date: inv.issueDate || core.dateOf(inv) || 'undated', vendor: inv.vendor || 'vendor', number: inv.number || '',
        company: co ? co.name.split(',')[0] : '', person: inv.billedPerson ? core.personLabel(inv.billedPerson) : '', category: inv.category || '',
        total: inv.total != null ? inv.total.toFixed(2) : ''
      };
      var name = String(pattern || '{date}_{vendor}_{number}').replace(/\{(\w+)\}/g, function (m, k) { return TOKENS.indexOf(k) !== -1 ? safePart(map[k]) : ''; });
      name = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/_{2,}/g, '_').replace(/^[_\-.]+|[_\-.]+$/g, '').slice(0, 120) || 'invoice';
      return name + '.' + core.fileExt(inv);
    }

    function monthOf(inv) { return String(core.dateOf(inv) || '').slice(0, 7); }

    function acctList() {
      var co = $('ac-company').value;
      var from = $('ac-from').value || '0000-00';
      var to = $('ac-to').value || '9999-99';
      if (from > to) { var t = from; from = to; to = t; }
      return core.state.invoices.filter(function (inv) {
        var m = monthOf(inv);
        if (m < from || m > to) return false;
        if (co === core.UNASSIGNED) return !core.companyById(inv.billedTo);
        return !co || inv.billedTo === co;
      }).sort(function (a, b) { return core.dateOf(a) < core.dateOf(b) ? -1 : 1; });
    }

    function acctPreview() {
      var list = acctList();
      var pattern = $('ac-pattern').value.trim() || '{date}_{vendor}_{number}';
      $('ac-count').textContent = list.length ? core.plural(list.length, 'invoice', 'invoices') + ' · ' + core.money(core.sum(list, core.eurOf)) + ' (incl. VAT, in EUR)' : 'No invoices for this company and period.';
      $('ac-example').textContent = list.length ? 'Example file name: ' + fileNameFor(list[0], pattern) : '';
      $('ac-go').disabled = !list.length;
    }

    function openAccountant() {
      var s = core.state.settings;
      var opts = [['', 'All companies']].concat(core.companies().map(function (c) { return [c.id, core.companyLabel(c.id)]; })).concat([[core.UNASSIGNED, 'Unassigned']]);
      core.setOptions($('ac-company'), opts, core.state.filters.company || '');
      var now = new Date();
      var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var ym = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
      if (core.state.filters.year && core.state.filters.month) ym = core.state.filters.year + '-' + core.state.filters.month;
      $('ac-from').value = ym;
      $('ac-to').value = ym;
      $('ac-pattern').value = s.exportPattern || '{date}_{vendor}_{number}';
      $('ac-sep').value = s.exportSep === ',' ? ',' : ';';
      acctPreview();
      $('acct').showModal();
    }

    function numFor(v, sep) { return v == null || isNaN(v) ? '' : sep === ';' ? v.toFixed(2).replace('.', ',') : v.toFixed(2); }
    function cell(v, sep) {
      var s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
      return new RegExp('["\\r\\n' + (sep === ';' ? ';' : ',') + ']').test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    async function runAccountant() {
      var list = acctList();
      if (!list.length) return;
      var s = core.state.settings;
      var pattern = $('ac-pattern').value.trim() || '{date}_{vendor}_{number}';
      var sep = $('ac-sep').value === ',' ? ',' : ';';
      s.exportPattern = pattern;
      s.exportSep = sep;
      core.saveSettings();
      var btn = $('ac-go');
      btn.disabled = true;
      var status = $('ac-status');
      try {
        var entries = [];
        var names = {};
        var missing = [];
        for (var i = 0; i < list.length; i++) {
          var inv = list[i];
          status.textContent = 'Adding ' + (i + 1) + ' of ' + list.length + '…';
          var name = fileNameFor(inv, pattern);
          var base = name.replace(/\.[^.]+$/, '');
          var ext = name.slice(base.length);
          var n = 2;
          while (names[name.toLowerCase()]) name = base + '-' + (n++) + ext;
          names[name.toLowerCase()] = true;
          inv._exportName = name;
          try {
            var blob = await core.fileBlob(inv, function () { status.textContent = 'Downloading ' + (inv.vendor || inv.fileName) + ' from the cloud…'; });
            entries.push({ name: name, data: blob, date: new Date((inv.issueDate || core.todayIso()) + 'T12:00:00') });
          } catch (e) { missing.push(inv); inv._exportName = '(missing) ' + name; }
        }
        var head = ['Date', 'Vendor', 'Vendor VAT ID', 'Invoice number', 'Net', 'VAT', 'Total', 'Currency', 'Total EUR', 'Category', 'Billed to company', 'Billed to VAT ID', 'Billed to person', 'Person email', 'Payment status', 'Paid on', 'Paid amount', 'Due date', 'File name'];
        var rowsOut = list.map(function (inv) {
          var co = core.companyById(inv.billedTo);
          var paidAmt = inv.paid && !core.paidAmount(inv) ? inv.total : core.paidAmount(inv);
          return [inv.issueDate, inv.vendor, inv.vendorTaxId, inv.number, numFor(inv.net, sep), numFor(inv.vat, sep), numFor(inv.total, sep), inv.currency || 'EUR', numFor(core.eurOf(inv), sep),
            inv.category, co ? co.name : 'Unassigned', co ? co.vatId : '', inv.billedPerson ? core.personLabel(inv.billedPerson) : '', inv.billedPerson || '',
            core.STATUS_LABEL[core.payState(inv)] + (core.payState(inv) === 'overdue' && core.paidAmount(inv) > 0 ? ' · partially paid' : ''), inv.paidDate || '', numFor(paidAmt, sep), inv.dueDate || '', inv._exportName];
        });
        var csv = '\ufeff' + [head].concat(rowsOut).map(function (r) { return r.map(function (c) { return cell(c, sep); }).join(sep); }).join('\r\n') + '\r\n';
        var coLabel = $('ac-company').selectedOptions[0] ? $('ac-company').selectedOptions[0].textContent : 'All companies';
        var from = $('ac-from').value, to = $('ac-to').value;
        var period = from === to ? from : from + ' to ' + to;
        var byCur = {};
        list.forEach(function (inv) {
          var c = inv.currency || 'EUR';
          if (!byCur[c]) byCur[c] = { net: 0, vat: 0, total: 0, n: 0 };
          byCur[c].net += inv.net || 0; byCur[c].vat += inv.vat || 0; byCur[c].total += inv.total || 0; byCur[c].n++;
        });
        var byCat = {};
        list.forEach(function (inv) { var k = inv.category || 'Other'; byCat[k] = (byCat[k] || 0) + (core.eurOf(inv) || 0); });
        var unpaid = list.filter(function (x) { return !x.paid; });
        var summary = ['Invoices for the accountant', '', 'Company: ' + coLabel, 'Period: ' + period, 'Invoices: ' + list.length, 'Exported: ' + new Date().toLocaleString('sl-SI'), '', 'Totals by currency'].concat(
          Object.keys(byCur).map(function (c) { var t = byCur[c]; return '  ' + c + ': net ' + t.net.toFixed(2) + ' · VAT ' + t.vat.toFixed(2) + ' · total ' + t.total.toFixed(2) + ' (' + t.n + ')'; }),
          ['', 'Total in EUR (incl. VAT): ' + core.sum(list, core.eurOf).toFixed(2), '', 'By category (EUR)'],
          Object.keys(byCat).sort().map(function (k) { return '  ' + k + ': ' + byCat[k].toFixed(2); }),
          ['', 'Unpaid: ' + unpaid.length + ' · open ' + core.sum(unpaid, core.remainingEur).toFixed(2) + ' EUR'],
          missing.length ? ['', 'Files not included (not in this browser or the cloud):'].concat(missing.map(function (x) { return '  ' + (x.vendor || x.fileName) + ' ' + (x.number || ''); })) : [],
          ['', 'File names: ' + pattern, 'Spreadsheet: invoices.csv (' + (sep === ';' ? 'semicolon-separated, decimal comma — opens directly in Excel with European settings' : 'comma-separated, decimal point') + ')']
        ).join('\r\n') + '\r\n';
        entries.push({ name: 'invoices.csv', data: csv }, { name: 'summary.txt', data: summary });
        list.forEach(function (inv) { delete inv._exportName; });
        var zip = await Z.make(entries);
        var coPart = safePart($('ac-company').value ? coLabel.replace(/\s*\(.*\)$/, '') : 'all-companies') || 'invoices';
        core.saveBlob(zip, 'invoices_' + coPart + '_' + (from === to ? from : from + '_' + to) + '.zip');
        status.textContent = missing.length ? core.plural(missing.length, 'file was', 'files were') + ' not available and are listed in summary.txt.' : '';
        if (!missing.length) $('acct').close();
        core.toast('Accountant export ready: ' + core.plural(list.length, 'invoice', 'invoices') + '.');
      } catch (e) {
        status.textContent = 'Export failed: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }

    // ---------- events ----------

    $('pay-add').addEventListener('click', addPayment);
    $('pay-amount').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addPayment(); } });
    ['d-iban', 'd-total', 'd-ref', 'd-vendor', 'd-number', 'd-due', 'd-cur', 'd-paid', 'd-payee-street', 'd-payee-city'].forEach(function (id) {
      $(id).addEventListener('input', function () { renderPays(); renderQr(); });
      $(id).addEventListener('change', function () { renderPays(); renderQr(); });
    });
    $('qr-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-kind]');
      if (!b) return;
      qrKind = b.dataset.kind;
      renderQr();
    });
    ['ac-company', 'ac-from', 'ac-to', 'ac-pattern'].forEach(function (id) { $(id).addEventListener('input', acctPreview); $(id).addEventListener('change', acctPreview); });
    $('ac-go').addEventListener('click', runAccountant);
    $('ac-close').addEventListener('click', function () { $('acct').close(); });
    $('ac-cancel').addEventListener('click', function () { $('acct').close(); });
    var METHOD_SEL = $('pay-method');
    METHODS.forEach(function (m) { METHOD_SEL.append(el('option', { value: m, text: m })); });

    return {
      onOpen: onOpen, collect: collect, renderPayments: renderPayments, maybeNotify: maybeNotify, enableNotify: enableNotify,
      exportIcs: exportIcs, compareDuplicates: compareDuplicates, openAccountant: openAccountant, fileNameFor: fileNameFor
    };
  }

  window.InvoiceFeatures = { init: init };
})();
