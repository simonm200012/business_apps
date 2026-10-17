/* The client's Accept page. DEMO: there is no server. The whole quote is in the link after the # (the part of a link
 * browsers never send anywhere), and the answer is not sent anywhere either:
 *   - it is stored in this browser (localStorage) and the Quotes app, if open in the same browser, picks it up;
 *   - the page also shows a "reply link" that the quote's owner can open on their own device to record the answer.
 * A real deployment would need a public endpoint that stores the answer on the server; this static demo does not have one,
 * and the site is behind Cloudflare Access, so a real client could not open this page without a separate Access rule.
 * Everything from the link is treated as untrusted text: Q.decodeShare limits and cleans it, and it is escaped when shown. */
(function () {
  'use strict';
  const Q = window.QuotesCore;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INBOX = 'stratum-quotes-inbox';
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

  const m = /^#q=([\w-]+)$/.exec(location.hash);
  const q = m && Q.decodeShare(m[1]);
  const root = $('#acc');
  if (!q) {
    root.innerHTML = '<div class="acc-one"><h1>This link does not open a quote</h1><p class="hint">It may be cut off. Ask the sender for the link again.</p></div>';
    return;
  }
  document.title = `Quote ${q.number} from ${q.company.name}`;
  const t = Q.totals(q);
  const answerKey = `stratum-quotes-answer:${q.id}`;
  let answer = null;
  try { answer = JSON.parse(get(answerKey) || 'null'); } catch (e) { answer = null; }
  const expired = !!q.validUntil && q.validUntil < Q.todayIso();

  function paper() {
    const rows = t.lines.map((l) => `<tr><td>${esc(l.description)}${l.note ? `<span class="nt">${esc(l.note)}</span>` : ''}</td><td class="r">${esc(String(l.qty).replace('.', ','))}</td><td class="r">${Q.eur(Q.cents(l.unitPrice), { plain: true })}</td><td class="r">${l.discountPct ? esc(String(l.discountPct).replace('.', ',')) + ' %' : ''}</td><td class="r">${Q.eur(l.amount, { plain: true })}</td></tr>`).join('');
    return `<div class="paper"><div class="top"><div><h4>Quote</h4><div class="m">${esc(q.number)} · ${esc(Q.dmy(q.issueDate))}</div></div><div style="text-align:right"><b>${esc(q.company.name)}</b><div class="m">${esc(q.company.address)}<br>${esc(q.company.city)}</div></div></div>
      <div style="margin:12px 0"><div class="m">Prepared for</div><b>${esc(q.client.name)}</b><br>${esc(q.client.address)}${q.client.address && q.client.city ? ', ' : ''}${esc(q.client.city)}</div>
      <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Disc.</th><th class="r">Amount</th></tr>${rows}</table>
      <div class="tt"><div><span>Subtotal</span><span>${Q.eur(t.subtotal)}</span></div>${t.discount ? `<div><span>Discount ${esc(Q.pct(q.discountPct))}</span><span>${Q.eur(-t.discount)}</span></div><div><span>Net</span><span>${Q.eur(t.net)}</span></div>` : ''}<div><span>VAT ${esc(Q.pct(q.vatPct))}</span><span>${Q.eur(t.vat)}</span></div><div class="g"><span>Total</span><span>${Q.eur(t.total)}</span></div></div>
      <div class="foot">Valid until ${esc(Q.dmy(q.validUntil))}.${q.terms ? ' ' + esc(q.terms) : ''}</div></div>`;
  }
  function summary() {
    const items = t.lines.map((l) => `<div class="pl"><div class="a"><span>${esc(l.description)}</span><span>${Q.eur(l.amount, { plain: true })}</span></div><div class="b"><span>${esc(String(l.qty).replace('.', ','))} × ${Q.eur(Q.cents(l.unitPrice))}${l.discountPct ? ` · ${esc(String(l.discountPct).replace('.', ','))} % off` : ''}</span></div></div>`).join('');
    return `<div class="lg"><i></i><span>${esc(q.company.name)}</span></div>
      <div class="hint acc-gap">Quote ${esc(q.number)} for ${esc(q.client.name)}</div>
      <div class="acc-total">${Q.eur(t.total)}</div><div class="hint">Valid until ${esc(Q.dmy(q.validUntil))}</div>
      <div class="acc-items">${items}<div class="tot" style="margin-top:12px"><div><span>Subtotal</span><span>${Q.eur(t.subtotal)}</span></div>${t.discount ? `<div><span>Discount <span class="hint">${esc(Q.pct(q.discountPct))}</span></span><span>${Q.eur(-t.discount)}</span></div><div><span>Net</span><span>${Q.eur(t.net)}</span></div>` : ''}<div><span>VAT ${esc(Q.pct(q.vatPct))}</span><span>${Q.eur(t.vat)}</span></div><div class="g"><span>Total</span><span>${Q.eur(t.total)}</span></div></div></div>`;
  }
  function replyLink(r) { return `${new URL('./', location.href).href.split('#')[0]}#reply=${Q.encodeReply(r)}`; }
  function done(r) {
    const accepted = r.kind === 'accepted';
    return `<h2 id="acc-h">${accepted ? 'Thank you, the quote is accepted' : 'You declined this quote'}</h2>
      <p class="hint">${accepted ? `${esc(q.company.name)} will send you the invoice.` : `${esc(q.company.name)} is told that you do not want to go ahead.`} Answered on ${esc(Q.dmy(r.at))}${r.name ? ` by ${esc(r.name)}` : ''}.</p>
      <div class="callout"><span class="t1"><b>Demo:</b> this answer is saved in this browser only. If ${esc(q.company.name)} uses Quotes on another device, send them this reply link.</span></div>
      <div class="linkbox" style="margin-top:12px"><input class="inp" id="reply" readonly value="${esc(replyLink(r))}" aria-label="Reply link"><button class="btn" id="copy">Copy</button></div>
      <p><button class="btn" id="print">Download PDF</button></p>`;
  }
  function form() {
    if (expired) return `<h2 id="acc-h">This quote has expired</h2><p class="hint">It was valid until ${esc(Q.dmy(q.validUntil))}. Ask ${esc(q.company.name)} for a new one.</p><p><button class="btn" id="print">Download PDF</button></p>`;
    return `<h2 id="acc-h">Review and accept</h2><p class="hint acc-lead">Accepting confirms the scope and prices. ${esc(q.company.name)} will send you the invoice.</p>
      <label class="lbl" for="a-name">Your name</label><input class="inp acc-in" id="a-name" autocomplete="name" maxlength="80" placeholder="Name and company">
      <label class="lbl" for="a-note" style="margin-top:12px">Note (optional)</label><textarea class="inp acc-in" id="a-note" maxlength="500" placeholder="For example a preferred start date"></textarea>
      <p id="a-err" class="hint" role="alert" style="color:var(--bad);min-height:20px;margin:8px 0 0"></p>
      <button class="btn p xl acc-btn" id="accept">Accept quote</button><button class="btn xl acc-btn" id="decline">Decline</button>
      <p><button class="btn sm" id="print">Download PDF</button></p>`;
  }
  function draw() {
    root.innerHTML = `<div class="acc-split"><section class="acc-l" aria-label="Quote">${summary()}</section><section class="acc-r" aria-labelledby="acc-h" id="acc-r">${answer ? done(answer) : form()}</section></div>`;
    $('#printArea').innerHTML = paper();
    $('#print').addEventListener('click', () => window.print());
    const c = $('#copy'); if (c) c.addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#reply').value); c.textContent = 'Copied'; } catch (e) { $('#reply').select(); } });
    const a = $('#accept'), d = $('#decline');
    if (a) a.addEventListener('click', () => submit('accepted'));
    if (d) d.addEventListener('click', () => submit('declined'));
  }
  function submit(kind) {
    const name = $('#a-name').value.trim().slice(0, 80), note = $('#a-note').value.trim().slice(0, 500);
    if (kind === 'accepted' && name.length < 2) { $('#a-err').textContent = 'Please type your name to accept.'; $('#a-name').focus(); return; }
    answer = { id: q.id, kind, name, note, at: Q.todayIso() };
    set(answerKey, JSON.stringify(answer));
    let inbox = []; try { inbox = JSON.parse(get(INBOX) || '[]'); } catch (e) { inbox = []; }
    if (!Array.isArray(inbox)) inbox = [];
    inbox.push(answer); set(INBOX, JSON.stringify(inbox.slice(-50)));
    if ('BroadcastChannel' in window) { const ch = new BroadcastChannel('stratum-quotes'); ch.postMessage('inbox'); ch.close(); }
    draw(); $('#acc-h').focus && $('#acc-h').setAttribute('tabindex', '-1'); $('#acc-h').focus();
  }
  draw();
})();
