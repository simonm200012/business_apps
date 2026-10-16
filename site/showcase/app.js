/* Tokovi showcase: scroll reveals, the animated "ask your data" window, tabbed product mock-ups,
 * a ⌘K jump menu and a brief builder. Everything is static and illustrative; nothing is sent anywhere. */
(function () {
  'use strict';

  // Set an address here to show an "E-mail it to us" button next to "Copy brief".
  const CONTACT_EMAIL = 'simonm2000@outlook.com';

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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mnav.hidden) { menuBtn.setAttribute('aria-expanded', 'false'); mnav.hidden = true; menuBtn.focus(); } });
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

  // ── look switch: Classic (style.css) or Linear (linear.css, on html[data-look="linear"]) ──
  // The head script applies the saved look before first paint; ?look=linear|classic wins for that page view.
  const LOOK_KEY = 'stratum-showcase-look', root = document.documentElement;
  const drawLook = () => {
    const look = root.getAttribute('data-look') === 'linear' ? 'linear' : 'classic';
    $$('[data-set-look]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLook === look)));
    $$('[data-toggle-look]').forEach((b) => { const t = 'Switch to the ' + (look === 'linear' ? 'Classic' : 'Linear') + ' design'; b.setAttribute('aria-label', t); b.title = t; });
  };
  const setLook = (look) => {
    if (look === 'linear') root.setAttribute('data-look', 'linear'); else root.removeAttribute('data-look');
    try { localStorage.setItem(LOOK_KEY, look); } catch (e) { /* storage unavailable: the choice lasts for this page view */ }
    try { // keep a ?look= address in step, so a reload shows what was picked
      const u = new URL(location.href);
      if (u.searchParams.has('look')) { u.searchParams.set('look', look); history.replaceState(history.state, '', u); }
    } catch (e) { /* ignore */ }
    drawLook();
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-look],[data-toggle-look]');
    if (!b) return;
    setLook(b.hasAttribute('data-toggle-look') ? (root.getAttribute('data-look') === 'linear' ? 'classic' : 'linear') : b.dataset.setLook);
  });
  drawLook();

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

  // ── dates in the mock-ups follow today, so the page never shows a delivery or a campaign that is already past ──
  const DATES = (() => {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const season = ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'AUTUMN', 'AUTUMN', 'AUTUMN', 'WINTER'][m];
    return {
      year: y,
      nextMonth: new Date(y, m + 1, 1).toLocaleDateString('en-GB', { month: 'long' }),
      code: season + String(m === 0 || m === 1 ? y - 1 : y).slice(-2), // the winter season is named after the year it starts
      eta: (days) => new Date(y, m, now.getDate() + days).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    };
  })();
  $$('[data-year]').forEach((el) => { el.textContent = DATES.year + (+el.getAttribute('data-year') || 0); });
  $$('[data-next-month]').forEach((el) => { el.textContent = DATES.nextMonth; });

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
        [['Lens supplier A', DATES.eta(1), '12,400'], ['Frames supplier B', DATES.eta(3), '3,180'], ['Solutions supplier C', DATES.eta(7), '6,020'], ['Sunglasses supplier D', DATES.eta(14), '1,940']].map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('') + '</tbody></table>' },
    { q: 'Rebuild the Sales report from Power BI', items: [['▣', 'Sales report', 'Power BI', '#E5B127'], ['✓', 'Reconciliation', 'Check', '#4CB782'], ['⧉', 'Web app version', 'App', '#7B66F0']],
      preview: () => '<div class="pv-h">Revenue · year to date</div><div class="pv-match"><div><i>Power BI</i><b>€1,284,330.52</b></div><div><i>Web app</i><b>€1,284,330.52</b></div></div><span class="okpill">✓ Match to the cent · 42 of 42 measures</span>' },
    { q: 'Automate supplier invoices into accounting', items: [['✉', 'Invoice inbox', 'Trigger', '#E5689A'], ['⌁', 'Read & extract', 'AI', '#7B66F0'], ['→', 'Post to accounting', 'Action', '#4CB782']],
      preview: () => '<div class="pv-h">Supplier invoice · PDF</div><div class="pv-big">€4,812.40</div><ol class="pv-steps">' +
        ['Invoice received', 'Supplier, dates and VAT read', 'Matched to PO-' + DATES.year + '-0418', 'Posted to accounting'].map((s) => '<li><span>✓</span>' + s + '</li>').join('') + '</ol>' }
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

  // ── apps grid (each opens a working demo in Business Apps) ─────────────────
  // Billing, Invoice reader and Desk are left out on purpose: they open Simon's own data, not a demo.
  // [name, what it does, path (folder, or a page inside it; the folder names its icon in ../icons/apps/), colour (⌘K menu), group]
  const APPS = [
    ['Cash forecast', 'A 13-week cash forecast from invoices, bills, payroll and pipeline, with warnings and scenarios.', 'cashflow', '#17869C', 'Finance'],
    ['Collections', 'Who owes you, who to call today and the reminder letter ready to send, with statutory late-payment interest worked out.', 'collections', '#E0703F', 'Finance'],
    ['Budget vs actual', 'The budget next to actual results month by month, with the variances to explain, an EBITDA bridge and a full-year outlook.', 'budget', '#5B3FE0', 'Finance'],
    ['Payment reconciliation', 'Payments, refunds and payouts matched to orders and the bank, with a month-end export.', 'recon', '#26B5CE', 'Finance'],
    ['Contracts & renewals', 'Every lease and supplier contract with notice deadlines, renewals and annual spend.', 'contracts', '#9B88F5', 'Finance'],
    ['CRM', 'Companies, contacts, a deal pipeline and activities, with forecasts and win rates.', 'crm', '#17869C', 'Sales & marketing'],
    ['Email marketing', 'Profiles, segments, campaigns, a drag-and-drop editor and automated flows.', 'mail', '#E0703F', 'Sales & marketing'],
    ['Marketing calendar', 'Every campaign and promotion per market in one calendar, next to what it spent and earned.', 'marketing', '#E5689A', 'Sales & marketing'],
    ['Refill & win-back', 'Customers about to run out, how many can be reached, and whether reminders bring them back.', 'refill', '#4CB782', 'Sales & marketing'],
    ['Social posts', 'Posts and banners for every platform, with safe zones, a month planner and export.', 'postbench', '#B4561C', 'Sales & marketing'],
    ['Analytics', 'Sales, stores, funnel, ad return and customer cohorts, with filters and comparisons.', 'analytics', '#7B66F0', 'Insights'],
    ['Ads & return', 'Google Ads and Meta spend against revenue and bookings, per market and campaign, with wasted spend.', 'ads', '#3E5BA9', 'Insights'],
    ['Margin guard', 'Which discounts, price lists, brands and shops lose margin, and yesterday\'s loss-making sales.', 'margin', '#E0703F', 'Insights'],
    ['Web shop conversion', 'Where shoppers drop off, by shop, device and page, and which tracking looks broken.', 'webshop', '#26B5CE', 'Insights'],
    ['Customer service quality', 'NPS, answer times, SLA and how much the chatbot handles, by market and queue.', 'cs-quality', '#9B88F5', 'Insights'],
    ['Data health check', 'Upload a customer or product list: invalid VAT numbers and IBANs, duplicates and gaps found in seconds, and a clean file back.', 'datacheck', '#4CB782', 'Insights'],
    ['ERP', 'Products and stock per location, purchasing, sales orders, invoices and payments.', 'erp', '#3E5BA9', 'Operations'],
    ['Store daily board', 'Yesterday\'s sales, month-to-date against target and today\'s team, per store.', 'stores', '#E5689A', 'Operations'],
    ['Parcels & COD', 'Every parcel across carriers, stuck shipments worked, cash on delivery reconciled.', 'parcels', '#B4561C', 'Operations'],
    ['Service jobs', 'A technician\'s day on the phone with checklists, photos and signatures, plus a dispatch board and signed service reports.', 'service', '#F2994A', 'Operations'],
    ['Branch bookings', 'Bookings, branches and managers side by side, with a booking calendar per branch.', 'branch-manager/Bookings.html', '#4CB782', 'Operations'],
    ['Team Tasks', 'Issues, cycles and projects with a board, an inbox and keyboard shortcuts.', 'team-tasks', '#5B3FE0', 'Team & IT'],
    ['Joiners & leavers', 'Checklists for new hires, moves and leavers across HR, IT and managers.', 'onboarding', '#4CB782', 'Team & IT'],
    ['Time & leave', 'Leave requests and approvals, a team calendar with public holidays, remaining days and monthly working-time records.', 'leave', '#26B5CE', 'Team & IT'],
    ['App usage & speed', 'Who uses which internal apps, how fast and reliable they are, and what the cloud costs.', 'hub-usage', '#17869C', 'Team & IT'],
    ['Automation runs', 'Every n8n workflow: health, runs per day, missed and failed runs, last deploy.', 'n8n', '#F2994A', 'Team & IT']
  ];
  const GROUPS = ['Finance', 'Sales & marketing', 'Insights', 'Operations', 'Team & IT'];
  const appHref = (a) => '../' + (a[2].includes('/') ? a[2] : a[2] + '/');
  const appIcon = (a) => '../icons/apps/' + a[2].split('/')[0] + '.png'; // made by tools/make-icons.mjs
  $('#appsCount').textContent = APPS.length;
  $('#appsGrid').innerHTML = APPS.map((a, i) => '<a class="app reveal" data-group="' + esc(a[4]) + '" href="' + appHref(a) + '" target="_blank" rel="noopener" style="transition-delay:' + (i % 4) * 60 + 'ms">' +
    '<span class="app-ico"><img src="' + appIcon(a) + '" alt="" width="44" height="44" loading="lazy" decoding="async"></span>' +
    '<span class="app-grp">' + esc(a[4]) + '</span><h3>' + esc(a[0]) + '</h3><p>' + esc(a[1]) + '</p><span class="go">Open the demo ↗<span class="sr"> (opens in a new tab)</span></span></a>').join('');
  // filter by team: plain toggle buttons, the grid keeps its order
  // phones show the first six until asked for the rest (24 cards in one column is a long scroll)
  let appsOpen = false;
  $('#appsMore').textContent = 'Show all ' + APPS.length + ' demos';
  $('#appsMore').addEventListener('click', () => { appsOpen = true; $('#appsGrid').classList.remove('collapsed'); $$('#appsGrid .app').forEach((el) => el.classList.add('in')); $('#appsGrid .app:nth-child(7)').focus(); });
  const appFilter = $('#appFilter');
  let group = 'All';
  function drawAppFilter() {
    appFilter.innerHTML = ['All'].concat(GROUPS).map((g) => {
      const n = g === 'All' ? APPS.length : APPS.filter((a) => a[4] === g).length;
      return '<button type="button" aria-pressed="' + (g === group) + '" data-g="' + esc(g) + '">' + esc(g) + ' <span class="n">' + n + '</span></button>';
    }).join('');
  }
  drawAppFilter();
  appFilter.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-g]'); if (!b) return;
    group = b.dataset.g; drawAppFilter();
    $('#appsGrid').classList.toggle('collapsed', group === 'All' && !appsOpen);
    $$('#appsGrid .app').forEach((el) => { const show = group === 'All' || el.dataset.group === group; el.hidden = !show; if (show) el.classList.add('in'); });
    const shown = group === 'All' ? APPS.length : APPS.filter((a) => a[4] === group).length;
    $('#appsStatus').textContent = 'Showing ' + shown + (group === 'All' ? ' demos' : ' ' + group + ' demos');
  });
  if ('IntersectionObserver' in window && !reduce) {
    const ao = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); ao.unobserve(e.target); } }), { threshold: 0.1 });
    $$('#appsGrid .reveal').forEach((el) => ao.observe(el));
  } else $$('#appsGrid .reveal').forEach((el) => el.classList.add('in'));

  // ── spreadsheet → app slider ─────────────────────────────────────────────
  // Drag anywhere on the picture (touch keeps vertical scrolling), or use the arrow keys on the hidden range input.
  const baStage = $('#baStage'), baRange = $('#baRange');
  if (baStage && baRange) {
    let baTouched = false, dragging = false;
    const setPos = (v) => {
      v = Math.max(0, Math.min(100, v));
      baStage.style.setProperty('--pos', v + '%');
      baRange.value = String(Math.round(v));
      baRange.setAttribute('aria-valuetext', v <= 5 ? 'Only the app' : v >= 95 ? 'Only the spreadsheet' : Math.round(v) + '% spreadsheet, ' + (100 - Math.round(v)) + '% app');
      baStage.classList.toggle('show-app', v < 22);
      baStage.classList.toggle('show-xl', v > 78);
    };
    const fromX = (x) => { const r = baStage.getBoundingClientRect(); setPos(((x - r.left) / r.width) * 100); };
    baStage.addEventListener('pointerdown', (e) => { if (e.button > 0) return; baTouched = dragging = true; baStage.setPointerCapture(e.pointerId); fromX(e.clientX); });
    baStage.addEventListener('pointermove', (e) => { if (dragging) fromX(e.clientX); });
    ['pointerup', 'pointercancel'].forEach((t) => baStage.addEventListener(t, () => { dragging = false; }));
    baRange.addEventListener('input', () => { baTouched = true; setPos(+baRange.value); });
    setPos(50);
    // once, when it first comes into view: a slow sweep that shows what dragging does
    if (!reduce && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) { io.disconnect(); setTimeout(sweep, 500); } }, { threshold: 0.55 });
      io.observe(baStage);
    }
    async function sweep() {
      for (const [a, b, ms] of [[50, 82, 900], [82, 22, 1300], [22, 50, 900]]) {
        const t0 = performance.now();
        await new Promise((done) => {
          const step = (t) => {
            if (baTouched) return done();
            const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
            setPos(a + (b - a) * e);
            if (k < 1) requestAnimationFrame(step); else done();
          };
          requestAnimationFrame(step);
        });
        if (baTouched) return;
      }
    }
  }

  // ── a day with your data ─────────────────────────────────────────────────
  const row = (ic, c, name, em, b, cls) => '<li' + (cls ? ' class="' + cls + '"' : '') + '><span class="m-ic" style="--c:' + c + '">' + ic + '</span>' + name + '<em>' + em + '</em>' + b + '</li>';
  const ok = (t) => '<b class="m-ok">' + (t || '✓') + '</b>';
  const CASH = [62, 66, 58, 61, 55, 46, 31, 52, 60, 64, 68, 71, 74];
  const DAY = [
    { app: 'Data platform · overnight load', mock: '<ul class="m-rows">' +
        row('▦', '#7B66F0', 'ERP & accounting', '412,380 rows', ok()) + row('⌂', '#26B5CE', 'Web shops', '18,402 orders', ok()) +
        row('▤', '#4CB782', 'Stores & POS', '6 stores', ok()) + row('◎', '#E5689A', 'Google Ads · Meta', '214 campaigns', ok()) +
        row('⇄', '#F2994A', 'Supplier price lists', '3 files', ok()) + '</ul>' +
        '<div class="m-foot"><span class="okpill">128 of 128 checks passed</span><span class="note">Ready at 06:12</span></div>' },
    { app: 'Store daily board · Koper', mock: '<div class="m-phone"><div class="m-ph-top"><b>Koper</b><span>Monday</span></div>' +
        '<div class="m-kpi"><i>Yesterday</i><b>€1,940</b><em>+4.2% vs a week before</em></div>' +
        '<div class="m-kpi"><i>Month to date</i><b>103% of target</b><span class="m-bar"><span style="width:100%"></span></span></div>' +
        '<ul class="m-mini"><li><span>Pickups to call</span><b>2</b></li><li><span>Today\'s team</span><b>Ana, Luka, Eva</b></li><li><span>New review</span><b>★★★★★</b></li></ul></div>' },
    { app: 'Supplier invoices → accounting', mock: '<ul class="m-rows">' +
        row('✉', '#F2994A', 'Lens supplier A', '€4,812.40', ok('Posted')) + row('✉', '#F2994A', 'Frames supplier B', '€1,206.00', ok('Posted')) +
        row('✉', '#F2994A', 'Logistics C', '€389.50', ok('Posted')) + row('✉', '#F2994A', 'Packaging D', '€742.10', ok('Posted')) +
        row('!', '#FF8A65', 'Solutions supplier E', '€2,118.00', '<b class="m-warn">Price differs €42</b>', 'm-warn-row') + '</ul>' +
        '<div class="m-foot"><span class="okpill">13 of 14 posted</span><span class="note">1 waits for a person</span></div>' },
    { app: 'Reorder predictions', mock: '<div class="m-seg"><span class="kicker">Likely to reorder · next 30 days</span><b class="m-big">1,284 customers</b><span class="m-sub">worth about €96,300</span>' +
        '<div class="m-split"><div><i style="--w:68%"></i><span>E-mail · 872</span></div><div><i style="--w:32%"></i><span>SMS · 412</span></div></div>' +
        '<span class="m-btn">Send to the ' + DATES.nextMonth + ' campaign →</span></div>' },
    { app: 'Margin guard', mock: '<div class="m-alert"><span class="m-alert-ic">!</span><div><b>Code ' + DATES.code + ' sells below cost</b><span>38 orders since Friday · −€612 margin</span></div></div>' +
        '<ul class="m-rows sm"><li>Brand X sunglasses<em>margin 8%</em><b class="m-warn">Check</b></li><li>Price list B2B-2<em>margin 41%</em>' + ok('OK') + '</li><li>Web shop HR<em>margin 57%</em>' + ok('OK') + '</li></ul>' +
        '<div class="m-foot"><span class="m-btn">Pause the code</span><span class="note">Caught the same day</span></div>' },
    { app: 'Cash forecast · 13 weeks', mock: '<div class="m-cash-h"><span class="kicker">13-week cash</span><b>Week 7 dips to €18,400</b><span class="m-sub">Your minimum is €25,000</span></div>' +
        '<div class="m-cbars">' + CASH.map((h, i) => '<i' + (i === 6 ? ' class="low"' : '') + ' style="height:' + h + '%"></i>').join('') + '<span class="min" style="bottom:40%"><span>minimum</span></span></div>' +
        '<span class="okpill">Move supplier B\'s payment to week 8 → stays above the minimum</span>' }
  ];
  const daySteps = $$('#daySteps .day-step'), dayMocks = $('#dayMocks'), dayDots = $('#dayDots');
  if (daySteps.length && dayMocks) {
    dayMocks.innerHTML = DAY.map((d, i) => '<div class="day-mock' + (i === 0 ? ' on' : '') + '">' + d.mock + '</div>').join('');
    dayDots.innerHTML = DAY.map((_, i) => '<i' + (i === 0 ? ' class="on"' : '') + '></i>').join('');
    $$('.day-inline').forEach((el) => {
      const d = DAY[+el.dataset.mock];
      el.innerHTML = '<div class="window day-win" aria-hidden="true"><div class="win-bar"><i></i><i></i><i></i><span>' + esc(d.app) + '</span></div><div class="day-mock on">' + d.mock + '</div></div>';
    });
    let current = -1;
    const setStep = (i) => {
      if (i === current) return;
      current = i;
      daySteps.forEach((li, k) => li.classList.toggle('on', k === i));
      $$('.day-mock', dayMocks).forEach((m, k) => m.classList.toggle('on', k === i));
      $$('i', dayDots).forEach((d, k) => d.classList.toggle('on', k === i));
      $('#dayTime').textContent = $('time', daySteps[i]).textContent;
      $('#dayApp').textContent = DAY[i].app;
    };
    setStep(0);
    if ('IntersectionObserver' in window) {
      // the step that crosses the middle of the screen is the one shown in the window
      const so = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) setStep(+e.target.dataset.step); }), { rootMargin: '-48% 0px -48% 0px' });
      daySteps.forEach((li) => so.observe(li));
    } else daySteps.forEach((li) => li.classList.add('on'));
  }

  // ── savings calculator ───────────────────────────────────────────────────
  // a full-time person: 40 hours a week and about 1,800 working hours a year (after holidays and leave), so 45 weeks
  const WEEK_HOURS = 40, FTE_HOURS = 1800, WEEKS = FTE_HOURS / WEEK_HOURS;
  const cIn = { people: $('#cPeople'), hours: $('#cHours'), rate: $('#cRate'), share: $('#cShare') };
  const fmt = (n) => Math.round(n).toLocaleString('en-GB');
  function calcValues() {
    const P = +cIn.people.value, H = +cIn.hours.value, R = +cIn.rate.value, S = +cIn.share.value / 100;
    const now = P * H * WEEKS, saved = now * S;
    return { P, H, R, S, now, saved, value: Math.round((saved * R) / 100) * 100 };
  }
  function calcRun() {
    const v = calcValues();
    Object.values(cIn).forEach((el) => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%'));
    $('#oPeople').textContent = v.P + (v.P === 1 ? ' person' : ' people');
    $('#oHours').textContent = v.H + (v.H === 1 ? ' hour' : ' hours');
    $('#oRate').textContent = '€' + v.R;
    $('#oShare').textContent = Math.round(v.S * 100) + '%';
    $('#rValue').textContent = '€' + fmt(v.value);
    $('#rHours').textContent = fmt(v.saved) + ' hours a year, from ' + fmt(v.now) + ' hours of manual work';
    $('#hNow').textContent = fmt(v.now) + ' h'; $('#hNew').textContent = fmt(v.now - v.saved) + ' h';
    $('#barNow').style.width = '100%'; $('#barNew').style.width = Math.max(2, (1 - v.S) * 100) + '%';
    const tenth = (x) => (x > 0 && x < 0.05 ? 'under 0.1' : x.toFixed(1));
    $('#rFte').textContent = tenth(v.saved / FTE_HOURS);
    $('#rWeeks').textContent = tenth(v.saved / v.P / WEEK_HOURS);
  }
  if (cIn.people) {
    Object.values(cIn).forEach((el) => el.addEventListener('input', calcRun));
    $('#calc').addEventListener('submit', (e) => e.preventDefault());
    calcRun();
    $('#calcUse').addEventListener('click', () => {
      const v = calcValues(), note = $('#bNote');
      const line = 'Our estimate: ' + v.P + ' people spend about ' + v.H + ' hours a week each on manual reports and data work (' + fmt(v.now) + ' hours a year). ' +
        'Automating ' + Math.round(v.S * 100) + '% of that would give back about ' + fmt(v.saved) + ' hours, roughly €' + fmt(v.value) + ' a year.';
      note.value = (note.value.split('\n').filter((l) => !l.startsWith('Our estimate:')).join('\n').trim() + '\n' + line).trim();
      ['Automation', 'Dashboards & analytics'].forEach((n) => { const b = $$('#needChips button').find((x) => x.textContent === n); if (b) b.setAttribute('aria-pressed', 'true'); });
      note.dispatchEvent(new Event('input'));
      $('#contact').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      const st = $('#briefStatus'); st.textContent = 'Your numbers are in the brief below.'; setTimeout(() => { st.textContent = ''; }, 5000);
    });
  }

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
    return 'Hello Tokovi,\n\nWe are a company of ' + $('#bSize').value.toLowerCase() + ' and we are looking at: ' + (needs.length ? needs.join(', ') : 'not sure yet') + '.\n' +
      'Timeline: ' + $('#bTime').value.toLowerCase() + '.' + (note ? '\n\n' + note : '') + '\n\nCould we set up a short call?';
  }
  const drawBrief = () => { out.textContent = brief(); const m = $('#mailBrief'); if (CONTACT_EMAIL) { m.hidden = false; m.href = 'mailto:' + CONTACT_EMAIL + '?subject=' + encodeURIComponent('Project enquiry') + '&body=' + encodeURIComponent(brief()); const w = $('#mailTo'); if (w) { w.hidden = false; w.querySelector('a').href = 'mailto:' + CONTACT_EMAIL; w.querySelector('a').textContent = CONTACT_EMAIL; } } };
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
  const SECTIONS = [['Services overview', '#services'], ['Data platform', '#platform'], ['Power BI', '#powerbi'], ['Analytics tools', '#analytics'], ['Predictions & AI', '#ai'], ['Business apps', '#apps'], ['Spreadsheet to app', '#apps'], ['A day with your data', '#day'], ['Automation', '#automation'], ['Savings calculator', '#savings'], ['How we work', '#process'], ['Questions', '#faq'], ['Start a project', '#contact']];
  const ITEMS = SECTIONS.map((s) => ({ sec: 'Sections', label: s[0], hint: 'Jump', icon: '#', c: '', run: () => { location.hash = s[1]; } }))
    .concat(APPS.map((a) => ({ sec: 'Live demos', label: a[0], hint: 'Opens demo', icon: a[0][0], c: a[3], run: () => window.open(appHref(a), '_blank', 'noopener') })));
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
