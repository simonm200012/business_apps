/* Stratum showcase: scroll reveals, the animated "ask your data" window, tabbed product mock-ups,
 * a ⌘K jump menu and a brief builder. Everything is static and illustrative; nothing is sent anywhere. */
(function () {
  'use strict';

  // Set an address here to show an "E-mail it to us" button next to "Copy brief".
  const CONTACT_EMAIL = '';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── nav: scrolled state, active section, mobile menu ─────────────────────
  const nav = $('#nav');
  const onScroll = () => {
    nav.classList.toggle('scrolled', scrollY > 8);
    const t = Math.min(1, scrollY / 420);
    document.documentElement.style.setProperty('--tilt', (10 - 10 * t).toFixed(2) + 'deg');
    document.documentElement.style.setProperty('--tscale', (0.97 + 0.03 * t).toFixed(3));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const menuBtn = $('#menuBtn'), mnav = $('#mnav');
  menuBtn.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') !== 'true';
    menuBtn.setAttribute('aria-expanded', String(open));
    mnav.hidden = !open;
  });
  mnav.addEventListener('click', (e) => { if (e.target.closest('a')) { menuBtn.setAttribute('aria-expanded', 'false'); mnav.hidden = true; } });
  const links = $$('.links a');
  if ('IntersectionObserver' in window) {
    const secObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach((s) => secObs.observe(s));
  }

  // ── reveal on scroll ─────────────────────────────────────────────────────
  if ('IntersectionObserver' in window && !reduce) {
    const ro = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target, sibs = $$('.reveal', el.parentElement).filter((x) => !x.classList.contains('in'));
        el.style.transitionDelay = Math.min(240, Math.max(0, sibs.indexOf(el)) * 70) + 'ms';
        el.classList.add('in');
        ro.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    $$('.reveal').forEach((el) => ro.observe(el));
  } else $$('.reveal').forEach((el) => el.classList.add('in'));

  // ── counters ─────────────────────────────────────────────────────────────
  const countEls = $$('[data-count]');
  if ('IntersectionObserver' in window && !reduce) {
    countEls.forEach((el) => { el.textContent = '0'; });
    const co = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target, to = Number(el.dataset.count), t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
        co.unobserve(el);
      });
    }, { threshold: 0.6 });
    countEls.forEach((el) => co.observe(el));
  }

  // ── hero: "ask your data" ────────────────────────────────────────────────
  const STORES = [['Ljubljana', 96, '€182.4k'], ['Maribor', 78, '€148.1k'], ['Zagreb', 71, '€134.9k'], ['Koper', 58, '€110.2k'], ['Split', 49, '€93.0k'], ['Celje', 41, '€77.8k']];
  const SCENES = [
    { q: 'Revenue by store, last 30 days', items: [['▦', 'Revenue by store', 'Dashboard', '#7B66F0'], ['€', 'Margin by store', 'Dashboard', '#26B5CE'], ['↗', 'Stores vs target', 'Report', '#4CB782'], ['⌁', 'Footfall & conversion', 'Dashboard', '#F2994A']],
      preview: () => '<div class="pv-h">Revenue · last 30 days</div><div class="pv-big">€746,400<small>+8.2%</small></div><div class="hbars">' +
        STORES.map((s) => '<div><span>' + s[0] + '</span><i data-w="' + s[1] + '"></i><b>' + s[2] + '</b></div>').join('') + '</div>' },
    { q: 'Which customers will reorder lenses next month?', items: [['◎', 'Reorder predictions', 'Model', '#7B66F0'], ['✉', 'Send to a campaign', 'Action', '#E5689A'], ['▤', 'Customer 360', 'App', '#3E5BA9']],
      preview: () => '<div class="pv-h">Likely to reorder · next 30 days</div><div class="pv-big">1,284 customers<small>€96.3k</small></div><div class="hbars">' +
        [['#10482', 92], ['#22917', 81], ['#30155', 67], ['#41870', 44]].map((c) => '<div><span>Customer ' + c[0] + '</span><i data-w="' + c[1] + '"></i><b>' + c[1] + '%</b></div>').join('') + '</div>' },
    { q: 'Stock in transit from suppliers', items: [['⇄', 'Stock in transit', 'App', '#26B5CE'], ['▦', 'Open purchase orders', 'Report', '#7B66F0'], ['⚑', 'Late shipments', 'Alert', '#F2994A']],
      preview: () => '<div class="pv-h">In transit · 14 shipments</div><div class="pv-big">€412,900</div><table class="ptable"><thead><tr><th>Supplier</th><th>ETA</th><th>Units</th></tr></thead><tbody>' +
        [['Lens supplier A', 'Oct 14', '12,400'], ['Frames supplier B', 'Oct 17', '3,180'], ['Solutions supplier C', 'Oct 21', '6,020'], ['Sunglasses supplier D', 'Oct 28', '1,940']].map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</tbody></table>' },
    { q: 'Rebuild the Sales report from Power BI', items: [['▣', 'Sales report', 'Power BI', '#E5B127'], ['✓', 'Reconciliation', 'Check', '#4CB782'], ['⧉', 'Web app version', 'App', '#7B66F0']],
      preview: () => '<div class="pv-h">Revenue · year to date</div><div class="pv-match"><div><i>Power BI</i><b>€1,284,330.52</b></div><div><i>Web app</i><b>€1,284,330.52</b></div></div><span class="okpill">✓ Match to the cent · 42 of 42 measures</span>' },
    { q: 'Automate supplier invoices into accounting', items: [['✉', 'Invoice inbox', 'Trigger', '#E5689A'], ['⌁', 'Read & extract', 'AI', '#7B66F0'], ['→', 'Post to accounting', 'Action', '#4CB782']],
      preview: () => '<div class="pv-h">Supplier invoice · PDF</div><div class="pv-big">€4,812.40</div><ol class="pv-steps">' +
        ['Invoice received', 'Supplier, dates and VAT read', 'Matched to PO-2026-0418', 'Posted to accounting'].map((s) => '<li><span>✓</span>' + s + '</li>').join('') + '</ol>' }
  ];
  const typed = $('#typed'), list = $('#cmdList'), preview = $('#cmdPreview');
  let heroVisible = true;
  if ('IntersectionObserver' in window) new IntersectionObserver((en) => { heroVisible = en[0].isIntersecting; }).observe($('.hero-window'));
  async function heroLoop() {
    let n = 0;
    for (;;) {
      const sc = SCENES[n % SCENES.length];
      while (!heroVisible || document.hidden) await wait(400);
      list.innerHTML = ''; preview.classList.remove('show'); preview.innerHTML = '';
      if (reduce) typed.textContent = sc.q;
      else for (let i = 1; i <= sc.q.length; i++) { typed.textContent = sc.q.slice(0, i); await wait(28 + Math.random() * 30); }
      await wait(250);
      list.innerHTML = sc.items.map((it, k) => '<li' + (k === 0 ? ' class="on"' : '') + '><span class="ci" style="--c:' + it[3] + '">' + it[0] + '</span>' + esc(it[1]) + '<span class="cm">' + it[2] + '</span></li>').join('');
      const lis = $$('li', list);
      for (const li of lis) { li.classList.add('show'); await wait(reduce ? 0 : 80); }
      preview.innerHTML = sc.preview();
      preview.classList.add('show');
      await wait(60);
      $$('.hbars i', preview).forEach((i) => { i.style.width = i.dataset.w + '%'; });
      const steps = $$('.pv-steps li', preview);
      for (const s of steps) { await wait(reduce ? 0 : 420); s.classList.add('done'); }
      await wait(reduce ? 6000 : 3400);
      if (!reduce) for (let i = sc.q.length; i >= 0; i -= 2) { typed.textContent = sc.q.slice(0, i); await wait(12); }
      n++;
    }
  }
  heroLoop();

  // ── tabs helper (roving tabindex, arrow keys) ────────────────────────────
  function tabs(tablist, onSelect) {
    const btns = $$('[role="tab"]', tablist);
    const select = (b, focus) => {
      btns.forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
      if (focus) b.focus();
      onSelect(b);
    };
    tablist.addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) select(b); });
    tablist.addEventListener('keydown', (e) => {
      const k = btns.indexOf(document.activeElement);
      if (k < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(btns[(k + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length], true); }
      if (e.key === 'Home') { e.preventDefault(); select(btns[0], true); }
      if (e.key === 'End') { e.preventDefault(); select(btns[btns.length - 1], true); }
    });
    return select;
  }
  tabs($('#powerbi [role="tablist"]'), (b) => { $$('#powerbi [role="tabpanel"]').forEach((p) => { p.hidden = p.id !== b.getAttribute('aria-controls'); }); });

  // ── analytics gallery ────────────────────────────────────────────────────
  const DASH = {
    Sales: { kpis: [['Revenue', '€1.28M', '+8.2%', 1], ['Orders', '18,402', '+5.7%', 1], ['Avg. order', '€69.79', '−0.6%', 0], ['Gross margin', '61.4%', '+1.1 pp', 1]],
      chart: ['line', 'Revenue by week', [42, 46, 44, 51, 49, 55, 53, 60, 58, 64, 61, 69, 72]], side: ['Top stores', [['Ljubljana', 96, '€182k'], ['Maribor', 78, '€148k'], ['Zagreb', 71, '€135k'], ['Koper', 58, '€110k'], ['Split', 49, '€93k']]] },
    Purchasing: { kpis: [['Open orders', '64', '+6', 2], ['In transit', '€412k', '14 shipments', 2], ['Days of cover', '38', '−4', 0], ['Late shipments', '7', '+2', 0]],
      chart: ['bar', 'Stock value by category', [88, 64, 52, 40, 31, 22, 15]], side: ['Reorder now', [['Daily lenses 30-pack', 92, '1,240'], ['Monthly lenses 6-pack', 76, '860'], ['Solution 360 ml', 61, '540'], ['Frames — classic', 38, '120'], ['Cases', 24, '300']]] },
    Customers: { kpis: [['Active customers', '84,210', '+6.1%', 1], ['Repeat rate', '41%', '+2 pp', 1], ['Due to reorder', '1,284', 'next 30 days', 2], ['Lifetime value', '€312', '+4.0%', 1]],
      chart: ['bar', 'New vs returning customers by month', [55, 58, 61, 57, 66, 70, 68, 74, 79, 83, 80, 88]], side: ['Segments', [['Contact lens regulars', 88, '21.4k'], ['Frames buyers', 64, '15.6k'], ['One-time buyers', 52, '12.7k'], ['Lapsed (> 1 year)', 34, '8.3k']]] },
    Marketing: { kpis: [['Ad spend', '€38.2k', 'this month', 2], ['Revenue (GA4)', '€146k', '+11%', 1], ['Return on spend', '3.8×', '+0.4', 1], ['Cost per booking', '€9.40', '−8%', 1]],
      chart: ['line', 'Revenue from paid traffic', [30, 34, 33, 39, 37, 45, 43, 48, 52, 50, 57, 61, 64]], side: ['Best campaigns', [['Search — brand', 94, '6.1×'], ['Search — lenses', 77, '4.4×'], ['Shopping — frames', 63, '3.6×'], ['Social — prospecting', 31, '1.4×']]] },
    Operations: { kpis: [['Orders shipped', '2,914', '+3%', 1], ['Same-day dispatch', '94%', '+2 pp', 1], ['Returns', '3.1%', '−0.4 pp', 1], ['Stuck parcels', '12', '−5', 1]],
      chart: ['bar', 'Shipments per day', [62, 71, 68, 80, 77, 40, 22, 65, 74, 72, 83, 79, 43, 25]], side: ['By carrier', [['Carrier A', 82, '1,204'], ['Carrier B', 61, '890'], ['National post', 43, '612'], ['Parcel lockers', 18, '208']]] }
  };
  function chartSvg(c) {
    const type = c[0], d = c[2], W = 600, H = 220, P = 8, max = Math.max(...d) * 1.1;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">';
    [0.25, 0.5, 0.75].forEach((f) => { s += '<line class="gl" x1="0" x2="' + W + '" y1="' + (H * f) + '" y2="' + (H * f) + '"/>'; });
    if (type === 'line') {
      const x = (i) => P + i * (W - 2 * P) / (d.length - 1), y = (v) => H - 10 - v / max * (H - 30);
      const path = d.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
      s += '<path class="ar" d="' + path + ' L' + x(d.length - 1) + ' ' + H + ' L' + x(0) + ' ' + H + 'Z"/><path class="ln" d="' + path + '"/>';
    } else {
      const bw = (W - 2 * P) / d.length;
      d.forEach((v, i) => { const h = v / max * (H - 20); s += '<rect class="bar' + (i === d.indexOf(Math.max(...d)) ? ' hi' : '') + '" x="' + (P + i * bw + bw * 0.18).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="5"/>'; });
    }
    return s + '</svg>';
  }
  const anTabs = $('#anTabs'), anPanel = $('#anPanel');
  anTabs.innerHTML = Object.keys(DASH).map((k, i) => '<button type="button" role="tab" id="anT' + i + '" aria-controls="anPanel" aria-selected="' + (i === 0) + '"' + (i ? ' tabindex="-1"' : ' class="on"') + '>' + k + '</button>').join('');
  function drawDash(name) {
    const d = DASH[name];
    $('#anTitleBar').textContent = name + ' · illustrative data';
    anPanel.setAttribute('aria-labelledby', $$('[role="tab"]', anTabs).find((b) => b.textContent === name).id);
    anPanel.innerHTML = d.kpis.map((k, i) => '<div class="dk" style="animation-delay:' + i * 50 + 'ms"><i>' + esc(k[0]) + '</i><b>' + esc(k[1]) + '</b><em class="' + (k[3] === 1 ? 'up' : k[3] === 0 ? 'dn' : '') + '">' + esc(k[2]) + '</em></div>').join('') +
      '<div class="dc"><h4>' + esc(d.chart[1]) + '</h4>' + chartSvg(d.chart) + '</div>' +
      '<div class="ds"><h4>' + esc(d.side[0]) + '</h4><ol>' + d.side[1].map((r) => '<li><span>' + esc(r[0]) + '</span><b>' + esc(r[2]) + '</b><i style="--w:' + r[1] + '%"></i></li>').join('') + '</ol></div>';
  }
  tabs(anTabs, (b) => drawDash(b.textContent));
  drawDash('Sales');

  // ── apps grid (each opens a working demo in Adrial Apps) ─────────────────
  const IC = {
    chart: '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>', box: '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18.5 14.6c1.4.7 2.4 2.2 2.8 4.4"/>',
    euro: '<path d="M17 6.5A6.5 6.5 0 1 0 17 17.5"/><path d="M4 10h9M4 14h9"/>', doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h6M9.5 16h6"/>',
    check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>', store: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16v10H4z"/><path d="M9.5 19.5v-5h5v5"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', arrows: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    file: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h3"/>', userplus: '<circle cx="10" cy="8" r="3.2"/><path d="M4 19c.8-3 3.2-4.6 6-4.6 1.6 0 3 .5 4.1 1.4M18 13v6M15 16h6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>'
  };
  const APPS = [
    ['Analytics', 'Sales, stores, funnel, ad return and customer cohorts — with filters and comparisons.', 'analytics', '#7B66F0', 'chart'],
    ['ERP', 'Products and stock per location, purchasing, sales orders, invoices and payments.', 'erp', '#3E5BA9', 'box'],
    ['CRM', 'Companies, contacts, a deal pipeline and activities, with forecasts and win rates.', 'crm', '#17869C', 'users'],
    ['Billing', 'Invoices, credit notes and monthly retainers with gap-free numbering and VAT reports.', 'billing', '#3F7D58', 'euro'],
    ['Invoice reader', 'Drop supplier PDFs — vendor, dates, VAT and totals are read for you.', 'invoices', '#F2994A', 'doc'],
    ['Team Tasks', 'Issues, cycles and projects with a board, an inbox and keyboard shortcuts.', 'team-tasks', '#5B3FE0', 'check'],
    ['Store daily board', 'Yesterday\'s sales, month-to-date against target and today\'s team, per store.', 'stores', '#E5689A', 'store'],
    ['Parcels & COD', 'Every parcel across carriers, stuck shipments worked, cash on delivery reconciled.', 'parcels', '#B4561C', 'truck'],
    ['Payment reconciliation', 'Payments, refunds and payouts matched to orders and the bank statement.', 'recon', '#26B5CE', 'arrows'],
    ['Contracts & renewals', 'Every lease and supplier contract with notice deadlines and renewals.', 'contracts', '#9B88F5', 'file'],
    ['Joiners & leavers', 'Checklists for new hires, moves and leavers across HR, IT and managers.', 'onboarding', '#4CB782', 'userplus'],
    ['Email marketing', 'Profiles, segments, campaigns, a drag-and-drop editor and automated flows.', 'mail', '#E0703F', 'mail']
  ];
  $('#appsGrid').innerHTML = APPS.map((a, i) => '<a class="app reveal" href="../' + a[2] + '/" target="_blank" rel="noopener" style="transition-delay:' + (i % 4) * 60 + 'ms">' +
    '<span class="app-ico" style="--c:' + a[3] + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[a[4]] + '</svg></span>' +
    '<h3>' + esc(a[0]) + '</h3><p>' + esc(a[1]) + '</p><span class="go">Open the demo ↗<span class="sr"> (opens in a new tab)</span></span></a>').join('');
  if ('IntersectionObserver' in window && !reduce) {
    const ao = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); ao.unobserve(e.target); } }), { threshold: 0.1 });
    $$('#appsGrid .reveal').forEach((el) => ao.observe(el));
  } else $$('#appsGrid .reveal').forEach((el) => el.classList.add('in'));

  // ── automation run ───────────────────────────────────────────────────────
  const steps = $$('#steps li');
  let autoVisible = false;
  if ('IntersectionObserver' in window) new IntersectionObserver((en) => { autoVisible = en[0].isIntersecting; }, { threshold: 0.4 }).observe($('#steps'));
  (async function autoLoop() {
    if (reduce) { steps.forEach((s) => s.classList.add('done')); return; }
    for (;;) {
      while (!autoVisible || document.hidden) await wait(400);
      steps.forEach((s) => s.classList.remove('done', 'active'));
      for (const s of steps) { s.classList.add('active'); await wait(700); s.classList.remove('active'); s.classList.add('done'); }
      await wait(2600);
    }
  })();

  // ── brief builder ────────────────────────────────────────────────────────
  const NEEDS = ['Data warehouse', 'Power BI', 'Dashboards & analytics', 'Predictions & AI', 'Business app', 'Automation', 'Cloud cost review', 'Not sure yet'];
  const chips = $('#needChips'), out = $('#briefText');
  chips.innerHTML = NEEDS.map((n, i) => '<button type="button" aria-pressed="' + (i === 1 || i === 2) + '">' + esc(n) + '</button>').join('');
  function brief() {
    const needs = $$('button[aria-pressed="true"]', chips).map((b) => b.textContent);
    const note = $('#bNote').value.trim();
    return 'Hello Stratum,\n\nWe are a company of ' + $('#bSize').value.toLowerCase() + ' and we are looking at: ' + (needs.length ? needs.join(', ') : 'not sure yet') + '.\n' +
      'Timeline: ' + $('#bTime').value.toLowerCase() + '.' + (note ? '\n\n' + note : '') + '\n\nCould we set up a short call?';
  }
  const drawBrief = () => { out.textContent = brief(); const m = $('#mailBrief'); if (CONTACT_EMAIL) { m.hidden = false; m.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('Project enquiry') + '&body=' + encodeURIComponent(brief()); } };
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); drawBrief(); });
  ['#bSize', '#bTime', '#bNote'].forEach((s) => $(s).addEventListener('input', drawBrief));
  $('#copyBrief').addEventListener('click', () => {
    const st = $('#briefStatus');
    const ok = () => { st.textContent = 'Copied — paste it into an e-mail or a message.'; setTimeout(() => { st.textContent = ''; }, 4000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(brief()).then(ok, () => { st.textContent = 'Select the text above and copy it.'; });
    else st.textContent = 'Select the text above and copy it.';
  });
  $('#brief').addEventListener('submit', (e) => e.preventDefault());
  drawBrief();

  // ── ⌘K jump menu ─────────────────────────────────────────────────────────
  const pal = $('#palette'), palIn = $('#palIn'), palList = $('#palList');
  const SECTIONS = [['Services overview', '#services'], ['Data platform', '#platform'], ['Power BI', '#powerbi'], ['Analytics tools', '#analytics'], ['Predictions & AI', '#ai'], ['Business apps', '#apps'], ['Automation', '#automation'], ['How we work', '#process'], ['Questions', '#faq'], ['Start a project', '#contact']];
  const ITEMS = SECTIONS.map((s) => ({ sec: 'Sections', label: s[0], hint: 'Jump', icon: '#', c: '', run: () => { location.hash = s[1]; } }))
    .concat(APPS.map((a) => ({ sec: 'Live demos', label: a[0], hint: 'Opens demo', icon: a[0][0], c: a[3], run: () => window.open('../' + a[2] + '/', '_blank', 'noopener') })));
  let palActive = 0, palItems = [], palReturn = null;
  function drawPal() {
    const q = palIn.value.trim().toLowerCase();
    palItems = ITEMS.filter((it) => !q || (it.label + ' ' + it.sec).toLowerCase().includes(q));
    palActive = Math.min(palActive, Math.max(0, palItems.length - 1));
    let h = '', sec = null;
    palItems.forEach((it, k) => {
      if (it.sec !== sec) { sec = it.sec; h += '<li class="sec-h" role="presentation">' + esc(sec) + '</li>'; }
      h += '<li class="it' + (k === palActive ? ' on' : '') + '" role="option" id="pal-' + k + '" data-k="' + k + '" aria-selected="' + (k === palActive) + '"><i' + (it.c ? ' style="--c:' + it.c + '"' : '') + '>' + esc(it.icon) + '</i>' + esc(it.label) + '<span>' + esc(it.hint) + '</span></li>';
    });
    palList.innerHTML = h || '<li class="empty">No matches</li>';
    palIn.setAttribute('aria-activedescendant', palItems.length ? 'pal-' + palActive : '');
    const on = $('.it.on', palList); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function openPal() { palReturn = document.activeElement; pal.hidden = false; palIn.value = ''; palActive = 0; drawPal(); palIn.focus(); }
  function closePal() { pal.hidden = true; if (palReturn && palReturn.focus) palReturn.focus(); }
  function choose(k) { const it = palItems[k]; if (!it) return; closePal(); it.run(); }
  $$('[data-open-palette]').forEach((b) => b.addEventListener('click', openPal));
  pal.addEventListener('click', (e) => { if (e.target.closest('[data-close-palette]')) closePal(); const it = e.target.closest('.it'); if (it) choose(Number(it.dataset.k)); });
  palList.addEventListener('mousemove', (e) => { const it = e.target.closest('.it'); if (it && Number(it.dataset.k) !== palActive) { palActive = Number(it.dataset.k); drawPal(); } });
  palIn.addEventListener('input', () => { palActive = 0; drawPal(); });
  palIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palActive = Math.min(palItems.length - 1, palActive + 1); drawPal(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palActive = Math.max(0, palActive - 1); drawPal(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(palActive); }
    else if (e.key === 'Escape') { e.preventDefault(); closePal(); }
    else if (e.key === 'Tab') e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (pal.hidden) openPal(); else closePal(); return; }
    const t = e.target;
    if (pal.hidden && e.key === '/' && !(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) { e.preventDefault(); openPal(); }
  });
})();
