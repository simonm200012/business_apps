/* Ads & Return (Adrial Apps): Google Ads + Meta spend against GA4 web results and store bookings.
 * Data comes from /api/ads/* (allowlisted Adrial Apps accounts only); nothing is stored in the browser. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (d) => new Intl.NumberFormat('sl-SI', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' });
  const N0 = nf(0), N1 = nf(1), N2 = nf(2);
  const eur = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `${(d ? nf(d) : N0).format(v)} €`);
  const eurT = (v) => (v != null && Math.abs(v) >= 1e6 ? `${N2.format(v / 1e6)} M €` : eur(v)); // tiles: keep millions short
  const num = (v) => (v == null || !Number.isFinite(v) ? '—' : N0.format(v));
  const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(d ? N1 : N0).format(v * 100)} %`);
  const ratio = (v) => (v == null || !Number.isFinite(v) ? '—' : `${N2.format(v)}×`);
  const div = (a, b) => (b ? a / b : null);
  const sum = (rows, k, f = () => true) => rows.filter(f).reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const DAY = 864e5;
  const iso = (d) => d.toISOString().slice(0, 10);
  const dmy = (s) => (s ? `${s.slice(8, 10)}. ${s.slice(5, 7)}. ${s.slice(0, 4)}` : '');
  // Change vs comparison; for costs a rise is bad (invert).
  function delta(cur, prev, invert = false) {
    if (!prev || cur == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return '<span class="delta muted">—</span>';
    const d = cur / prev - 1;
    const good = invert ? d < 0 : d > 0;
    return `<span class="delta ${Math.abs(d) < 0.005 ? '' : good ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${N1.format(Math.abs(d) * 100)} %</span>`;
  }

  // ---------- state ----------
  const state = { route: 'overview', preset: 'this_month', from: '', to: '', compare: 'yoy', market: '', platform: '', area: 'E-commerce',
    search: '', sort: { key: 'spend', dir: -1 }, wasteDays: 30, wasteMin: 100, store: '', meta: null, data: {}, session: null };
  const MARKETS = [['', 'All markets'], ['IT', 'Italy'], ['HR', 'Croatia'], ['SI', 'Slovenia']];
  const PRESETS = [['this_month', 'This month'], ['last_month', 'Last month'], ['last_30', 'Last 30 days'], ['qtd', 'Quarter to date'], ['ytd', 'Year to date'], ['custom', 'Custom']];

  function period() {
    const end = new Date((state.meta?.dataThrough || iso(new Date(Date.now() - DAY))) + 'T00:00:00Z');
    const y = end.getUTCFullYear(), m = end.getUTCMonth();
    const utc = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd));
    switch (state.preset) {
      case 'last_month': return [iso(utc(y, m - 1, 1)), iso(utc(y, m, 0))];
      case 'last_30': return [iso(new Date(end - 29 * DAY)), iso(end)];
      case 'qtd': return [iso(utc(y, Math.floor(m / 3) * 3, 1)), iso(end)];
      case 'ytd': return [iso(utc(y, 0, 1)), iso(end)];
      case 'custom': return [state.from || iso(utc(y, m, 1)), state.to || iso(end)];
      default: return [iso(utc(y, m, 1)), iso(end)];
    }
  }
  const qs = (extra = {}) => {
    const [from, to] = period();
    const p = new URLSearchParams({ from, to, compare: state.compare, market: state.market, ...extra });
    for (const [k, v] of [...p.entries()]) if (v === '') p.delete(k);
    return p.toString();
  };

  async function api(path) {
    if (state.data[path]) return state.data[path];
    const r = await fetch('/api/ads/' + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { await checkSession(); throw new Error(j.error || 'Not allowed'); }
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    state.data[path] = j;
    return j;
  }

  // ---------- icons ----------
  const ICON = {
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    store: '<path d="M3 9l1.5-5h15L21 9M4 9v11h16V9M3 9h18M9 20v-6h6v6"/>', gauge: '<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/>',
    alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>', funnel: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  };
  const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
  const NAV = [['overview', 'grid', 'Overview'], ['campaigns', 'list', 'Campaigns'], ['stores', 'store', 'Stores'], ['pacing', 'gauge', 'Budget pacing'], ['waste', 'alert', 'Wasted spend'], ['channels', 'funnel', 'Channels'], ['data', 'info', 'Data & definitions']];

  function renderSide() {
    const u = state.session;
    const initials = (u?.email || '?').replace(/@.*/, '').split(/[._-]+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    $('#side').innerHTML = `
      <div class="brand"><div class="brand-tile">${icon('chart', 22)}</div><div><b>Ads & Return</b><span class="mono">Google · Meta · GA4</span></div></div>
      ${u?.allowed ? `<div class="chip-user" style="cursor:default"><span class="avatar">${esc(initials)}</span><span style="min-width:0"><b>${esc(u.email)}</b><span class="mono">approved account</span></span></div>` : ''}
      <nav class="main" aria-label="Main"><div class="navgroup">
        ${NAV.map(([k, ic, l]) => `<a class="navitem" href="#${k}"${state.route === k ? ' aria-current="page"' : ''}>${icon(ic)}<span class="grow">${l}</span></a>`).join('')}
      </div></nav>
      <div class="side-foot mono"><span>Data through ${esc(dmy(state.meta?.dataThrough) || '…')}</span><span>Refreshed daily · v1.0</span></div>`;
  }

  // ---------- shared fragments ----------
  const seg = (name, opts, cur) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" aria-pressed="${cur === v}" data-set="${name}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  function filterBar({ market = true, compare = true, presets = true } = {}) {
    const [from, to] = period();
    return `<div class="filters">
      ${presets ? seg('preset', PRESETS, state.preset) : ''}
      ${presets && state.preset === 'custom' ? `<input type="date" data-date="from" value="${from}" max="${esc(state.meta?.dataThrough || '')}" aria-label="From"><input type="date" data-date="to" value="${to}" max="${esc(state.meta?.dataThrough || '')}" aria-label="To">` : ''}
      ${presets ? `<span class="mono small muted">${dmy(from)} – ${dmy(to)}</span>` : ''}
      ${compare ? seg('compare', [['yoy', 'vs last year'], ['prev', 'vs previous period']], state.compare) : ''}
      ${market ? seg('market', MARKETS, state.market) : ''}
    </div>`;
  }
  const head = (title, lede, actions = '') => `<div class="head-row"><div style="flex:1 1 420px"><h1 class="title">${esc(title)}<i>.</i></h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions ? `<div class="top-actions">${actions}</div>` : ''}</div>`;
  const tile = (k, v, d = '', inv = false) => `<div class="tile${inv ? ' inv' : ''}"><span class="k mono">${k}</span><span class="v">${v}</span>${d ? `<span class="s">${d}</span>` : ''}</div>`;
  const op = (s) => `<span class="op mono">${s}</span>`;
  const card = (title, sub, inner) => `<div class="card"><h3>${title}</h3><div class="sub mono">${sub}</div>${inner}</div>`;
  const loading = () => '<div class="card empty">Loading…</div>';

  // Bars (stacked series) + optional line on its own axis, as inline SVG.
  function chart(days, bars, line, { lineClass = 'rev', fmtBar = eur, fmtLine = eur } = {}) {
    const W = 900, H = 240, L = 56, R = 56, T = 12, B = 26;
    const n = days.length || 1;
    const bw = Math.max(1, (W - L - R) / n * 0.7);
    const barMax = Math.max(1, ...days.map((d) => bars.reduce((a, b) => a + (d[b.key] || 0), 0)));
    const lineMax = line ? Math.max(1, ...days.map((d) => d[line.key] || 0)) : 1;
    const x = (i) => L + (i + 0.5) * (W - L - R) / n;
    const yb = (v) => H - B - v / barMax * (H - T - B);
    const yl = (v) => H - B - v / lineMax * (H - T - B);
    let svg = '';
    for (let g = 0; g <= 4; g++) {
      const y = T + g * (H - T - B) / 4;
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 3}" text-anchor="end">${esc(fmtBar(barMax * (1 - g / 4)).replace(' €', ''))}</text>`;
      if (line) svg += `<text x="${W - R + 6}" y="${y + 3}">${esc(fmtLine(lineMax * (1 - g / 4)).replace(' €', ''))}</text>`;
    }
    days.forEach((d, i) => {
      let base = 0;
      for (const b of bars) {
        const v = d[b.key] || 0;
        if (v > 0) svg += `<rect class="${b.cls}" x="${x(i) - bw / 2}" y="${yb(base + v)}" width="${bw}" height="${Math.max(0.5, yb(base) - yb(base + v))}"><title>${d.date} · ${b.label}: ${fmtBar(v)}</title></rect>`;
        base += v;
      }
      if (n <= 62 ? (i % Math.ceil(n / 10) === 0) : (d.date.endsWith('-01'))) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.date.slice(5).replace('-', '.')}</text>`;
    });
    if (line) svg += `<polyline class="${lineClass}" points="${days.map((d, i) => `${x(i)},${yl(d[line.key] || 0)}`).join(' ')}"><title>${line.label}</title></polyline>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily chart">${svg}</svg>`;
  }

  // ---------- Overview ----------
  async function pageOverview() {
    const d = await api('overview?' + qs());
    const cur = (r) => r.period === 'cur', prv = (r) => r.period === 'prev';
    const k = (p) => {
      const ads = d.ads.filter(p), ga = d.ga4.filter(p), paid = d.paid.filter(p), ap = d.appointments.filter(p);
      const ecom = (r) => r.area === 'E-commerce', opt = (r) => r.area === 'Optics / retail';
      const o = {
        google: sum(ads, 'spend', (r) => r.platform === 'Google'), meta: sum(ads, 'spend', (r) => r.platform === 'Meta'),
        ecomSpend: sum(ads, 'spend', ecom), optSpend: sum(ads, 'spend', opt),
        revenue: sum(ga, 'revenue'), orders: sum(ga, 'orders'), sessions: sum(ga, 'sessions'), paidRevenue: sum(ga, 'paid_revenue'),
        googleGa4Rev: sum(paid, 'revenue', (r) => r.platform === 'Google'), metaGa4Rev: sum(paid, 'revenue', (r) => r.platform === 'Meta'),
        metaValue: sum(ads, 'conv_value', (r) => r.platform === 'Meta'),
        googleEcom: sum(ads, 'spend', (r) => r.platform === 'Google' && ecom(r)), metaEcom: sum(ads, 'spend', (r) => r.platform === 'Meta' && ecom(r)),
        appointments: sum(ap, 'appointments'),
      };
      o.total = o.google + o.meta;
      o.mer = div(o.revenue, o.ecomSpend); o.cpo = div(o.ecomSpend, o.orders); o.paidShare = div(o.paidRevenue, o.revenue);
      o.googleRoas = div(o.googleGa4Rev, o.googleEcom); o.metaRoas = div(o.metaGa4Rev, o.metaEcom); o.metaClaimed = div(o.metaValue, o.metaEcom);
      o.cpb = div(o.optSpend, o.appointments);
      return o;
    };
    const c = k(cur), p = k(prv);
    // Bookings come from a separate export that can lag; never show a missing period as zero.
    const apThrough = d.freshness?.Appointments || '';
    const noBookings = apThrough && d.window.from > apThrough;
    const bookingsPartial = apThrough && !noBookings && d.window.to > apThrough; // comparison is cut at the same day by the server
    if (noBookings) { c.appointments = null; c.cpb = null; }
    // daily series
    const byDay = new Map();
    for (const r of d.ads.filter(cur)) { const x = byDay.get(r.date) || { date: r.date }; x[r.platform] = (x[r.platform] || 0) + r.spend; byDay.set(r.date, x); }
    for (const r of d.ga4.filter(cur)) { const x = byDay.get(r.date) || { date: r.date }; x.revenue = (x.revenue || 0) + r.revenue; byDay.set(r.date, x); }
    const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    // by market
    const markets = ['IT', 'HR', 'SI'].filter((m) => !state.market || m === state.market).map((m) => {
      const f = (pp) => (r) => pp(r) && r.market === m;
      const row = (pp) => ({ google: sum(d.ads.filter(f(pp)), 'spend', (r) => r.platform === 'Google'), meta: sum(d.ads.filter(f(pp)), 'spend', (r) => r.platform === 'Meta'),
        ecom: sum(d.ads.filter(f(pp)), 'spend', (r) => r.area === 'E-commerce'), revenue: sum(d.ga4.filter(f(pp)), 'revenue'), orders: sum(d.ga4.filter(f(pp)), 'orders') });
      return { m, cur: row(cur), prev: row(prv) };
    });
    const cmp = d.window.compare === 'yoy' ? 'last year' : 'previous period';
    return `${filterBar()}
      ${head('Overview', `What Google and Meta cost and what the web shops and optics got back, ${esc(dmy(d.window.from))} – ${esc(dmy(d.window.to))}, compared with the ${cmp}. Web return uses e-commerce ad spend only; optics campaigns are measured on store bookings.`)}
      <div class="grid2">
        ${card('Ad spend', 'All campaigns, EUR', `<div class="tiles">${tile('Google', eurT(c.google), delta(c.google, p.google, true))}${op('+')}${tile('Meta', eurT(c.meta), delta(c.meta, p.meta, true))}${op('=')}${tile('Total', eurT(c.total), delta(c.total, p.total, true), true)}</div>`)}
        ${card('Web shop return', 'GA4 revenue and orders against e-commerce ad spend', `<div class="tiles">${tile('Revenue (GA4)', eurT(c.revenue), delta(c.revenue, p.revenue))}${op('÷')}${tile('E-com ad spend', eurT(c.ecomSpend), delta(c.ecomSpend, p.ecomSpend, true))}${op('=')}${tile('Revenue per € of ads', ratio(c.mer), delta(c.mer, p.mer), true)}</div>`)}
        ${card('Efficiency', 'Per order and by platform, both ROAS measured by GA4', `<div class="tiles">${tile('Cost per order', eur(c.cpo, 2), delta(c.cpo, p.cpo, true))}${tile('Google ROAS', ratio(c.googleRoas), delta(c.googleRoas, p.googleRoas))}${tile('Meta ROAS', ratio(c.metaRoas), `${delta(c.metaRoas, p.metaRoas)}<br><span class="muted">Meta itself reports ${ratio(c.metaClaimed)}</span>`)}${tile('Paid share of revenue', pct(c.paidShare), delta(c.paidShare, p.paidShare))}</div>`)}
        ${card('Optics stores', noBookings ? `Booking data runs through ${dmy(apThrough)}; this period has none yet` : `Online eye-exam bookings against store campaign spend${bookingsPartial ? ` · bookings through ${dmy(apThrough)}` : ''}`, `<div class="tiles">${tile('Store ad spend', eurT(c.optSpend), delta(c.optSpend, p.optSpend, true))}${op('÷')}${tile('Bookings', noBookings ? '—' : num(c.appointments), noBookings ? 'no data yet' : delta(c.appointments, p.appointments))}${op('=')}${tile('Cost per booking', noBookings ? '—' : eur(c.cpb, 2), noBookings ? '' : delta(c.cpb, p.cpb, true), true)}</div>`)}
      </div>
      <div class="card"><h3>Daily spend and revenue</h3><div class="sub mono">Bars: ad spend (left axis) · line: GA4 revenue (right axis)</div>
        ${chart(days, [{ key: 'Google', cls: 'g', label: 'Google' }, { key: 'Meta', cls: 'm', label: 'Meta' }], { key: 'revenue', label: 'GA4 revenue' })}
        <div class="legend mono"><span><i></i>Google</span><span><i class="m"></i>Meta</span><span><i class="rev"></i>GA4 revenue</span></div></div>
      <div class="card table-card"><div class="table-head"><h3>By market</h3></div><div class="tw"><table><thead><tr>
        <th>Market</th><th class="num">Google</th><th class="num">Meta</th><th class="num">Total spend</th><th class="num">vs ${cmp}</th><th class="num">Revenue (GA4)</th><th class="num">vs ${cmp}</th><th class="num">Orders</th><th class="num">Revenue per €</th><th class="num">Cost per order</th></tr></thead><tbody>
        ${markets.map(({ m, cur: a, prev: b }) => `<tr><td><b>${esc(MARKETS.find((x) => x[0] === m)[1])}</b></td><td class="num">${eur(a.google)}</td><td class="num">${eur(a.meta)}</td><td class="num">${eur(a.google + a.meta)}</td><td class="num">${delta(a.google + a.meta, b.google + b.meta, true)}</td><td class="num">${eur(a.revenue)}</td><td class="num">${delta(a.revenue, b.revenue)}</td><td class="num">${num(a.orders)}</td><td class="num">${ratio(div(a.revenue, a.ecom))}</td><td class="num">${eur(div(a.ecom, a.orders), 2)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  // ---------- Campaigns ----------
  const AWARENESS = /reach|youtube|demgen|demand ?gen|awareness|video|brand ?lift|vcpm/i;
  async function pageCampaigns() {
    const d = await api('campaigns?' + qs({ platform: state.platform, area: state.area }));
    const q = state.search.trim().toLowerCase();
    let rows = d.campaigns.filter((c) => !q || c.campaign.toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q));
    rows = rows.map((c) => ({ ...c, cpc: div(c.spend, c.clicks), ctr: div(c.clicks, c.impressions), platformRoas: c.platform === 'Meta' ? div(c.conv_value, c.spend) : null,
      ga4Roas: div(c.revenue, c.spend), cpo: div(c.spend, c.orders), cpb: div(c.spend, c.appointments) }));
    const { key, dir } = state.sort;
    rows.sort((a, b) => { const x = a[key], y = b[key]; if (typeof x === 'string' || typeof y === 'string') return dir * String(x || '').localeCompare(String(y || '')); return dir * ((x ?? -Infinity) - (y ?? -Infinity)); });
    const tot = { spend: sum(rows, 'spend'), prev: sum(rows, 'prev_spend'), clicks: sum(rows, 'clicks'), orders: sum(rows, 'orders'), revenue: sum(rows, 'revenue'), appointments: sum(rows, 'appointments'), conv: sum(rows, 'conversions') };
    state.csv = rows;
    const th = (k, l, cls = 'num') => `<th class="sort ${cls}" data-sort="${k}">${l}${state.sort.key === k ? (state.sort.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
    return `${filterBar()}
      ${head('Campaigns', 'Every Google and Meta campaign with spend in the period, what the platform reports and what GA4 recorded for the same campaign. Platform conversions follow each platform\'s own attribution; GA4 orders and revenue are matched by campaign name.', `<button class="btn" data-act="csv">${icon('download', 18)}CSV</button>`)}
      <div class="filters">${seg('platform', [['', 'Both platforms'], ['Google', 'Google'], ['Meta', 'Meta']], state.platform)}${seg('area', [['', 'All campaigns'], ['E-commerce', 'E-commerce'], ['Optics / retail', 'Optics stores']], state.area)}
        <div class="search" style="flex:0 1 320px"><input type="search" id="q" placeholder="Search campaign or category" value="${esc(state.search)}" style="min-height:40px;padding-left:16px"></div></div>
      <div class="card table-card"><div class="table-head"><h3>${num(rows.length)} campaigns · ${eur(tot.spend)}</h3><span class="mono small muted">GA4 matched ${num(rows.filter((r) => r.sessions).length)} of ${num(rows.length)}</span></div>
      <div class="tw"><table><thead><tr>${th('campaign', 'Campaign', '')}${th('spend', 'Spend')}${th('prev_spend', 'vs comparison')}${th('clicks', 'Clicks')}${th('cpc', 'CPC')}${th('ctr', 'CTR')}${th('conversions', 'Platform conv.')}${th('platformRoas', 'Meta-reported ROAS')}${th('orders', 'GA4 orders')}${th('revenue', 'GA4 revenue')}${th('ga4Roas', 'GA4 ROAS')}${th('cpo', 'Cost / order')}${th('appointments', 'Bookings')}</tr></thead><tbody>
        ${rows.slice(0, 400).map((c) => `<tr><td style="min-width:260px"><b>${esc(c.campaign)}</b><br><span class="tag ${c.platform === 'Google' ? 'g' : 'm'}">${c.platform}</span> <span class="tag">${esc(c.market)}</span> <span class="tag">${esc(c.store ? `Optics · ${c.store}` : (c.category || c.area || ''))}</span>${AWARENESS.test(c.campaign) ? ' <span class="tag warn">awareness</span>' : ''}</td>
          <td class="num">${eur(c.spend)}</td><td class="num">${delta(c.spend, c.prev_spend, true)}</td><td class="num">${num(c.clicks)}</td><td class="num">${eur(c.cpc, 2)}</td><td class="num">${pct(c.ctr, 2)}</td><td class="num">${c.conversions ? N1.format(c.conversions) : '—'}</td><td class="num">${ratio(c.platformRoas)}</td><td class="num">${c.orders ? num(c.orders) : '—'}</td><td class="num">${c.revenue ? eur(c.revenue) : '—'}</td><td class="num">${ratio(c.ga4Roas)}</td><td class="num">${eur(c.cpo, 2)}</td><td class="num">${c.appointments ? num(c.appointments) : '—'}</td></tr>`).join('')}
        <tr class="total"><td>Total</td><td class="num">${eur(tot.spend)}</td><td class="num">${delta(tot.spend, tot.prev, true)}</td><td class="num">${num(tot.clicks)}</td><td class="num">${eur(div(tot.spend, tot.clicks), 2)}</td><td></td><td class="num">${num(tot.conv)}</td><td></td><td class="num">${num(tot.orders)}</td><td class="num">${eur(tot.revenue)}</td><td class="num">${ratio(div(tot.revenue, tot.spend))}</td><td class="num">${eur(div(tot.spend, tot.orders), 2)}</td><td class="num">${num(tot.appointments)}</td></tr>
      </tbody></table></div>${rows.length > 400 ? '<div class="note small muted" style="padding:12px 20px">Showing the top 400; the CSV has all.</div>' : ''}</div>`;
  }

  // ---------- Stores ----------
  async function pageStores() {
    const d = await api('stores?' + qs());
    const rows = d.stores.map((s) => ({ ...s, spend: s.google + s.meta, cpb: div(s.google + s.meta, s.appointments) }));
    const sel = state.store && rows.some((r) => r.store === state.store) ? state.store : (rows[0]?.store || '');
    const byDay = new Map();
    for (const r of d.daily.filter((x) => x.store === sel)) { const x = byDay.get(r.date) || { date: r.date }; x[r.kind] = r.value; byDay.set(r.date, x); }
    const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    const tot = { spend: sum(rows, 'spend'), appt: sum(rows, 'appointments'), prev: sum(rows, 'prev_appointments'), paid: sum(rows, 'from_paid') };
    // Bookings come from a separate export that can lag: a period after it has no data, not zero bookings.
    const none = d.appointmentsThrough && d.window.from > d.appointmentsThrough;
    const B = (v) => (none ? '—' : num(v));
    const D = (a, b) => (none ? '' : delta(a, b));
    const CPB = (s) => (none ? '—' : eur(div(s.spend, s.appointments), 2));
    return `${filterBar()}
      ${head('Stores', `Online eye-exam bookings per optics location against that store's own Google and Meta campaigns. Bookings are tracked through ${esc(dmy(d.appointmentsThrough))}${d.bookings?.partial && !d.bookings?.none ? `; booking figures cover ${esc(dmy(d.window.from))} – ${esc(dmy(d.bookings.ato))} and are compared with the same days a year earlier` : ''}.`)}
      ${none ? `<div class="banner warn"><span class="dot"></span><b>No booking data for this period yet</b><span class="mono grow">The appointment export runs through ${esc(dmy(d.appointmentsThrough))}. Spend is shown; choose an earlier period to compare bookings.</span><button class="btn small" data-set="preset" data-v="last_month">Last month</button></div>` : ''}
      <div class="card table-card"><div class="table-head"><h3>${rows.length} optics</h3><span class="mono small muted">Bookings after a paid click include clicks on any paid campaign</span></div><div class="tw"><table><thead><tr>
        <th>Store</th><th>Market</th><th class="num">Google</th><th class="num">Meta</th><th class="num">Store ad spend</th><th class="num">Bookings</th><th class="num">vs comparison</th><th class="num">After a paid click</th><th class="num">From this store's ads</th><th class="num">Cost per booking</th></tr></thead><tbody>
        ${rows.map((s) => `<tr class="click" data-store="${esc(s.store)}"${s.store === sel ? ' style="background:var(--sunken)"' : ''}><td><b>${esc(s.store)}</b></td><td>${esc(s.market)}</td><td class="num">${eur(s.google)}</td><td class="num">${eur(s.meta)}</td><td class="num">${eur(s.spend)}</td><td class="num">${B(s.appointments)}</td><td class="num">${D(s.appointments, s.prev_appointments)}</td><td class="num">${B(s.from_paid)}</td><td class="num">${B(s.from_store_ads)}</td><td class="num">${s.spend ? CPB(s) : '<span class="tag">no store ads</span>'}</td></tr>`).join('')}
        <tr class="total"><td colspan="4">Total</td><td class="num">${eur(tot.spend)}</td><td class="num">${B(tot.appt)}</td><td class="num">${D(tot.appt, tot.prev)}</td><td class="num">${B(tot.paid)}</td><td></td><td class="num">${none ? '—' : eur(div(tot.spend, tot.appt), 2)}</td></tr>
      </tbody></table></div></div>
      <div class="card"><h3>${esc(sel || 'Store')} · daily</h3><div class="sub mono">Bars: store ad spend (left) · line: bookings (right). Click a store above to switch.</div>
        ${chart(days, [{ key: 'spend', cls: 'g', label: 'Ad spend' }], { key: 'appointments', label: 'Bookings' }, { lineClass: 'appt', fmtLine: num })}
        <div class="legend mono"><span><i></i>Ad spend</span><span><i class="appt"></i>Bookings</span></div></div>`;
  }

  // ---------- Pacing ----------
  async function pagePacing() {
    const d = await api('pacing');
    const remaining = d.daysInMonth - d.dayOfMonth;
    const rows = d.rows.filter((r) => !state.market || r.market === state.market).map((r) => ({
      ...r, forecast: r.mtd + r.last7_daily * remaining, linear: r.mtd / d.dayOfMonth * d.daysInMonth }));
    rows.sort((a, b) => a.market.localeCompare(b.market) || a.platform.localeCompare(b.platform) || a.area.localeCompare(b.area));
    const tot = (k) => sum(rows, k);
    const flag = (r) => { const x = div(r.forecast, r.last_month_total); return x == null ? '' : x > 1.15 ? '<span class="tag warn">above last month</span>' : x < 0.85 ? '<span class="tag">below last month</span>' : ''; };
    return `<div class="filters">${seg('market', MARKETS, state.market)}</div>
      ${head('Budget pacing', `${esc(d.month)}: ${d.dayOfMonth} of ${d.daysInMonth} days have data (through ${esc(dmy(d.asof))}). The forecast adds the last 7 days' daily spend for each remaining day.`)}
      <div class="grid2">${card('This month so far', `Through ${dmy(d.asof)}`, `<div class="tiles">${tile('Spent', eur(tot('mtd')), delta(tot('mtd'), tot('last_month_same_days'), true) + ' <span class="muted">vs same days last month</span>')}${op('→')}${tile('Forecast', eur(tot('forecast')), delta(tot('forecast'), tot('last_month_total'), true) + ' <span class="muted">vs last month</span>', true)}</div>`)}
        ${card('Reference', 'Full-month totals', `<div class="tiles">${tile('Last month', eur(tot('last_month_total')))}${tile('Same month last year', eur(tot('last_year_total')), delta(tot('forecast'), tot('last_year_total'), true) + ' <span class="muted">forecast vs</span>')}</div>`)}</div>
      <div class="card table-card"><div class="tw"><table><thead><tr><th>Market</th><th>Platform</th><th>Campaigns</th><th class="num">Spent</th><th class="num">Same days last month</th><th class="num">Last 7 days / day</th><th class="num">Forecast</th><th class="num">Last month</th><th class="num">Same month last year</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><b>${esc(r.market)}</b></td><td><span class="tag ${r.platform === 'Google' ? 'g' : 'm'}">${esc(r.platform)}</span></td><td>${esc(r.area)}</td><td class="num">${eur(r.mtd)}</td><td class="num">${eur(r.last_month_same_days)} ${delta(r.mtd, r.last_month_same_days, true)}</td><td class="num">${eur(r.last7_daily)}</td><td class="num"><b>${eur(r.forecast)}</b></td><td class="num">${eur(r.last_month_total)}</td><td class="num">${eur(r.last_year_total)}</td><td>${flag(r)}</td></tr>`).join('')}
        <tr class="total"><td colspan="3">Total</td><td class="num">${eur(tot('mtd'))}</td><td class="num">${eur(tot('last_month_same_days'))}</td><td class="num">${eur(tot('last7_daily'))}</td><td class="num">${eur(tot('forecast'))}</td><td class="num">${eur(tot('last_month_total'))}</td><td class="num">${eur(tot('last_year_total'))}</td><td></td></tr>
      </tbody></table></div></div>`;
  }

  // ---------- Wasted spend ----------
  async function pageWaste() {
    const d = await api(`waste?days=${state.wasteDays}&min=${state.wasteMin}${state.market ? '&market=' + state.market : ''}`);
    const rows = d.campaigns.map((c) => ({ ...c, awareness: AWARENESS.test(c.campaign) }));
    const real = rows.filter((r) => !r.awareness), aw = rows.filter((r) => r.awareness);
    const table = (list, title, note) => `<div class="card table-card"><div class="table-head"><h3>${title} · ${eur(sum(list, 'spend'))}</h3><span class="mono small muted">${note}</span></div>
      ${list.length ? `<div class="tw"><table><thead><tr><th>Campaign</th><th class="num">Spend</th><th class="num">Clicks</th><th class="num">Impressions</th><th class="num">GA4 sessions</th><th>Last spend</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.campaign)}</b><br><span class="tag ${c.platform === 'Google' ? 'g' : 'm'}">${c.platform}</span> <span class="tag">${esc(c.market)}</span> <span class="tag">${esc(c.category || c.area || '')}</span></td><td class="num">${eur(c.spend)}</td><td class="num">${num(c.clicks)}</td><td class="num">${num(c.impressions)}</td><td class="num">${num(c.sessions)}</td><td class="mono small">${dmy(c.last_spend)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">None.</div>'}</div>`;
    return `<div class="filters">${seg('wasteDays', [['30', 'Last 30 days'], ['60', 'Last 60 days'], ['90', 'Last 90 days']], String(state.wasteDays))}${seg('wasteMin', [['50', '≥ 50 €'], ['100', '≥ 100 €'], ['250', '≥ 250 €'], ['1000', '≥ 1.000 €']], String(state.wasteMin))}${seg('market', MARKETS, state.market)}</div>
      ${head('Wasted spend', `Campaigns that spent at least ${eur(d.minSpend)} between ${dmy(d.window.from)} and ${dmy(d.window.to)} with no platform conversion, no GA4 order and no store booking.`)}
      ${table(real, 'No results', 'Pause, fix tracking or rework these')}
      ${table(aw, 'Awareness campaigns', 'Reach / video / Demand Gen: no direct results are expected, judge them on reach and cost per view')}`;
  }

  // ---------- Channels ----------
  async function pageChannels() {
    const d = await api('channels?' + qs());
    const map = new Map();
    for (const r of d.rows) { const x = map.get(r.channel) || { channel: r.channel, cur: {}, prev: {} }; const t = x[r.period === 'cur' ? 'cur' : 'prev']; for (const k of ['sessions', 'engaged', 'orders', 'revenue', 'add_to_carts', 'checkouts']) t[k] = (t[k] || 0) + (r[k] || 0); map.set(r.channel, x); }
    const rows = [...map.values()].sort((a, b) => (b.cur.revenue || 0) - (a.cur.revenue || 0));
    const total = sum(rows.map((r) => r.cur), 'revenue');
    return `${filterBar()}
      ${head('Channels', 'Every GA4 traffic channel across the web shops: how much traffic it brings, how engaged it is, how often it converts and what it earns.')}
      <div class="card table-card"><div class="tw"><table><thead><tr><th>Channel</th><th class="num">Sessions</th><th class="num">vs comparison</th><th class="num">Engaged</th><th class="num">Add to cart / session</th><th class="num">Conversion rate</th><th class="num">Orders</th><th class="num">Revenue</th><th class="num">vs comparison</th><th class="num">Share</th><th class="num">Avg. order</th></tr></thead><tbody>
        ${rows.map(({ channel, cur: a, prev: b }) => `<tr><td><b>${esc(channel || '(not set)')}</b></td><td class="num">${num(a.sessions)}</td><td class="num">${delta(a.sessions, b.sessions)}</td><td class="num">${pct(div(a.engaged, a.sessions))}</td><td class="num">${pct(div(a.add_to_carts, a.sessions))}</td><td class="num">${pct(div(a.orders, a.sessions), 2)}</td><td class="num">${num(a.orders)}</td><td class="num">${eur(a.revenue)}</td><td class="num">${delta(a.revenue, b.revenue)}</td><td class="num">${pct(div(a.revenue, total))}</td><td class="num">${eur(div(a.revenue, a.orders), 2)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  // ---------- Data & definitions ----------
  async function pageData() {
    const f = state.meta?.freshness || {};
    const defs = [
      ['Ad spend', 'Google Ads cost and Meta spend in EUR, from the daily campaign loads (google_ads, meta_ads).'],
      ['Revenue, orders (GA4)', 'GA4 purchase revenue and transactions across the five web shops (adrialenti, adrialece, moje-lece, alensa.hr, alensa.si), by session channel.'],
      ['Revenue per € of ads', 'GA4 web revenue ÷ e-commerce ad spend (Google + Meta). Optics campaigns are left out because they drive store visits, not web orders.'],
      ['Cost per order', 'E-commerce ad spend ÷ GA4 orders, all channels. A blended number: it includes orders that ads did not drive.'],
      ['Google ROAS (GA4)', 'GA4 revenue from sessions GA4 attributes to Google Ads campaigns ÷ Google e-commerce spend.'],
      ['Meta ROAS', 'GA4 revenue from Facebook / Instagram paid sessions ÷ Meta e-commerce spend, the same basis as Google ROAS.'],
      ['Meta-reported ROAS', 'Purchase value Meta reports for its campaigns ÷ spend. Meta counts purchases after a click or after just seeing an ad, so with many repeat buyers it reads far higher than GA4 (often 40–70×). Use it to compare Meta campaigns with each other, not with Google.'],
      ['GA4 match per campaign', 'Google campaigns match GA4 by campaign name (about 99% of spend). Meta campaigns match GA4 Facebook / Instagram paid sessions by UTM campaign name; unmatched campaigns show "—".'],
      ['Bookings', 'Online eye-exam appointments tracked in GA4 per optics location. "After a paid click" counts bookings whose session came from any paid medium; "from this store\'s ads" only from the store\'s own campaigns.'],
      ['Wasted spend', 'Campaigns with spend above the threshold and zero platform conversions, GA4 orders and bookings. Reach, video and Demand Gen campaigns are listed separately.'],
      ['Forecast', 'Month-to-date spend + the last 7 days\' average daily spend × the days left in the month.'],
    ];
    return `${head('Data & definitions', 'Where the numbers come from and how they are calculated. The data is rebuilt every morning from BigQuery.')}
      <div class="grid2"><div class="card table-card"><div class="table-head"><h3>Data through</h3></div><div class="tw"><table><tbody>${Object.entries(f).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${esc(dmy(v))}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3>Access</h3><div class="sub mono">Real company data</div><p class="small">Only approved Adrial Apps accounts can load this data. Nothing is cached in your browser; every number comes from the server when you open a page.</p></div></div>
      <div class="card"><h3>Definitions</h3><div class="sub mono">${defs.length} measures</div><dl class="kv">${defs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
  }

  // ---------- gate, router, events ----------
  async function checkSession() {
    try { state.session = await fetch('/api/ads/session', { credentials: 'same-origin' }).then((r) => r.json()); } catch { state.session = null; }
    return state.session;
  }
  function gate() {
    const s = state.session;
    renderSide();
    const body = !s?.signedIn
      ? `<p>Ads & Return shows real ad spend and revenue, so it needs an approved Adrial Apps account.</p><button class="btn primary" data-act="signin">Sign in</button>`
      : `<p>You're signed in as <b>${esc(s.email)}</b>, but this account isn't approved for Ads & Return yet. Ask Simon to add it.</p><button class="btn" data-act="signin">Use another account</button>`;
    $('#main').innerHTML = `<div class="card gate"><h3>Sign in to see Ads & Return</h3><div class="sub mono">Google Ads · Meta · GA4</div>${body}</div>`;
  }
  const PAGES = { overview: pageOverview, campaigns: pageCampaigns, stores: pageStores, pacing: pagePacing, waste: pageWaste, channels: pageChannels, data: pageData };
  let renderSeq = 0;
  async function render() {
    if (!state.session?.allowed) return gate();
    state.route = (location.hash.replace('#', '') || 'overview');
    if (!PAGES[state.route]) state.route = 'overview';
    renderSide();
    const my = ++renderSeq;
    const main = $('#main');
    if (!main.innerHTML.trim() || main.dataset.route !== state.route) main.innerHTML = loading();
    main.dataset.route = state.route;
    try {
      const html = await PAGES[state.route]();
      if (my !== renderSeq) return;
      const focus = document.activeElement?.id;
      main.innerHTML = html;
      if (focus === 'q') { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      document.title = `${NAV.find((n) => n[0] === state.route)[2]} · Ads & Return · Adrial Apps`;
    } catch (e) {
      if (my !== renderSeq) return;
      if (!state.session?.allowed) return gate();
      main.innerHTML = `<div class="banner bad"><span class="dot"></span><b>Couldn't load</b><span class="mono grow">${esc(e.message)}</span><button class="btn small" data-act="retry">Retry</button></div>`;
    }
  }
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-set]');
    if (s) {
      const k = s.dataset.set, v = s.dataset.v;
      state[k] = ['wasteDays', 'wasteMin'].includes(k) ? Number(v) : v;
      if (k === 'preset' && v === 'custom') { const [f, t] = period(); state.from = f; state.to = t; }
      return render();
    }
    const sortEl = e.target.closest('[data-sort]');
    if (sortEl) { const k = sortEl.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'campaign' ? 1 : -1) }; return render(); }
    const st = e.target.closest('[data-store]');
    if (st) { state.store = st.dataset.store; return render(); }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'signin') window.AdrialSync?.signIn();
    if (a.dataset.act === 'retry') { state.data = {}; render(); }
    if (a.dataset.act === 'csv') {
      const cols = ['platform', 'market', 'area', 'category', 'store', 'campaign', 'spend', 'prev_spend', 'clicks', 'impressions', 'conversions', 'conv_value', 'sessions', 'orders', 'revenue', 'appointments'];
      const cell = (v) => { const t = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const csv = '﻿' + [cols.join(';'), ...(state.csv || []).map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n');
      const [f, t] = period();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `campaigns-${f}_${t}.csv`;
      document.body.appendChild(link); link.click(); link.remove();
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.date && t.value) { state[t.dataset.date] = t.value; render(); }
  });
  let qTimer;
  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') { state.search = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(render, 200); }
  });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  async function start() {
    await checkSession();
    if (state.session?.allowed) {
      try { state.meta = await api('meta'); } catch (e) { /* render shows the error */ }
    }
    render();
  }
  if (window.AdrialSync) window.AdrialSync.on(() => { state.data = {}; start(); });
  start();
})();
