/* Adrial Mail — Dashboard, Analytics (comparison, flows, cohorts, attribution, export), Event simulator. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, E = AM.E, UI = AM.UI, C = AM.C, esc = U.esc, ic = U.ic, I = U.I, DAY = U.DAY;
  var App = function () { return AM.App; };
  var COL = { campaign: 'var(--accent)', flow: 'var(--c-teal)', sms: 'var(--c-clay)' };

  function range(key) {
    var now = E.now();
    if (key === '90d') return [now - 90 * DAY, now, 'last 90 days'];
    if (key === '12m') return [now - 365 * DAY, now, 'last 12 months'];
    if (key === 'ytd') { var y = new Date(now).getFullYear(); return [new Date(y, 0, 1).getTime(), now, 'year to date']; }
    return [now - 30 * DAY, now, 'last 30 days'];
  }
  function refRevenue(from, to) {
    var out = {};
    E.attr().list.forEach(function (a) { if (!a.ref || a.ts < from || a.ts > to) return; var k = a.ref.split(':').slice(0, 2).join(':'); var o = out[k] || (out[k] = { rev: 0, orders: 0 }); o.rev += a.v; o.orders++; });
    return out;
  }
  function monthsBack(n) { var now = E.now(), out = []; for (var i = n - 1; i >= 0; i--) out.push(U.ym(U.addMonths(U.monthStart(now), -i))); return out; }

  // ── Dashboard ─────────────────────────────────────────────────────────
  AM.route(/^\/$/, function (page) {
    var db = E.db(), key = U.pref('period') || '30d', rg = range(key), len = rg[1] - rg[0];
    var cur = E.period(rg[0], rg[1]), prev = E.period(rg[0] - len, rg[0] - 1);
    var seg = '<div class="seg" role="group" aria-label="Period">' + [['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months'], ['ytd', 'Year to date']].map(function (p) { return '<button type="button" data-period="' + p[0] + '" aria-pressed="' + (p[0] === key) + '">' + p[1] + '</button>'; }).join('') + '</div>';
    var share = cur.totalRev ? cur.revenue / cur.totalRev : 0;
    var h = UI.head({ title: 'Dashboard', dot: true, sub: 'Email &amp; SMS performance, ' + esc(rg[2]) + ' · revenue attributed with a ' + db.settings.openWin + '-day open / ' + db.settings.clickWin + '-day click window · <a href="#/analytics/attribution">change</a>', actions: seg });
    h += '<div class="banner demo" style="margin-bottom:16px">' + ic(I.zap) + '<span>Demo data: 3,000 fictional subscribers in Slovenia and Croatia. Campaigns, flows and SMS are <b style="font-weight:500">simulated</b> — nothing is ever sent and no network call is made.</span></div>';
    h += '<div class="kpis">' + UI.kpi('Attributed revenue', U.money(cur.revenue), UI.delta(cur.revenue, prev.revenue) + '<br>' + U.pct(share) + ' of ' + U.money(cur.totalRev) + ' total store revenue', 'hero') +
      UI.kpi('Campaign revenue', U.money(cur.campaignRev), UI.delta(cur.campaignRev, prev.campaignRev)) +
      UI.kpi('Flow revenue', U.money(cur.flowRev), UI.delta(cur.flowRev, prev.flowRev)) +
      UI.kpi('SMS revenue', U.money(cur.smsRev), UI.delta(cur.smsRev, prev.smsRev)) + '</div>';
    h += '<div class="kpis">' + UI.kpi('Email recipients', U.n(cur.recipients), U.n(cur.campaignRecipients) + ' campaign · ' + U.n(cur.flowRecipients) + ' flow · ' + U.n(cur.smsRecipients) + ' SMS') +
      UI.kpi('Open rate', U.pct(cur.openRate), UI.delta(cur.openRate, prev.openRate)) +
      UI.kpi('Click rate', U.pct(cur.clickRate, 2), UI.delta(cur.clickRate, prev.clickRate)) +
      UI.kpi('Conversion rate', U.pct(cur.convRate, 2), U.n(cur.attrOrders) + ' attributed orders') +
      UI.kpi('Unsubscribe rate', U.pct(cur.unsubRate, 2), UI.delta(cur.unsubRate, prev.unsubRate, true)) +
      UI.kpi('List growth', (cur.netGrowth >= 0 ? '+' : '') + U.n(cur.netGrowth), U.n(cur.subs) + ' new · ' + U.n(cur.unsub) + ' unsubscribed') + '</div>';
    h += '<div class="grid2"><section class="card"><div class="card-h"><div><span class="label">Last 12 months</span><h2>Attributed revenue by month</h2></div><a class="btn sm ghost" href="#/analytics">Analytics</a></div><div class="chart" id="revChart"></div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">' + esc(rg[2]) + '</span><h2>Deliverability</h2></div></div><div class="card-b" id="deliv"></div></section></div>';
    h += '<div class="grid2 even mt"><section class="card"><div class="card-h"><div><span class="label">Sent ' + esc(rg[2]) + '</span><h2>Top campaigns</h2></div><a class="btn sm ghost" href="#/campaigns">All campaigns</a></div><div class="card-b" id="topC"></div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">' + esc(rg[2]) + '</span><h2>Top flows</h2></div><a class="btn sm ghost" href="#/flows">All flows</a></div><div class="card-b" id="topF"></div></section></div>';
    h += '<div class="grid2 even mt"><section class="card"><div class="card-h"><h2>Coming up</h2></div><ul class="rows" id="upcoming"></ul></section><section class="card"><div class="card-h"><h2>Audience</h2><a class="btn sm ghost" href="#/lists">Lists &amp; segments</a></div><div class="card-b" id="aud"></div></section></div>';
    page.innerHTML = h;

    var ms = monthsBack(12), at = E.attr().months;
    C.bars(page.querySelector('#revChart'), { labels: ms.map(U.ymLabel), stacked: true, total: true, fmt: U.money, yfmt: U.moneyShort, aria: 'Attributed revenue by month, campaigns versus flows versus SMS',
      series: [{ name: 'Campaigns', color: COL.campaign, values: ms.map(function (m) { return (at[m] || {}).campaign || 0; }) }, { name: 'Flows', color: COL.flow, values: ms.map(function (m) { return (at[m] || {}).flow || 0; }) }, { name: 'SMS', color: COL.sms, values: ms.map(function (m) { return (at[m] || {}).sms || 0; }) }] });

    var badge = function (v, warn, bad) { return v >= bad ? '<span class="chip bad">Needs attention</span>' : v >= warn ? '<span class="chip warn">Watch</span>' : '<span class="chip good">Healthy</span>'; };
    var supp = db.profiles.filter(function (p) { return p.sup; }).length;
    page.querySelector('#deliv').innerHTML = '<div class="tiles" style="padding:0 0 14px">' +
      '<div class="tile"><span class="label">Bounce rate</span><div class="v">' + U.pct(cur.bounceRate, 2) + '</div><small>' + U.n(cur.bounce) + ' bounces · ' + U.n(cur.hard) + ' hard</small>' + badge(cur.bounceRate, 0.01, 0.02) + '</div>' +
      '<div class="tile"><span class="label">Spam complaints</span><div class="v">' + U.pct(cur.spamRate, 3) + '</div><small>' + U.n(cur.spam) + ' complaints</small>' + badge(cur.spamRate, 0.0008, 0.003) + '</div>' +
      '<div class="tile"><span class="label">Unsubscribes</span><div class="v">' + U.pct(cur.unsubRate, 2) + '</div><small>' + U.n(cur.unsub) + ' email</small>' + badge(cur.unsubRate, 0.005, 0.01) + '</div>' +
      '<div class="tile"><span class="label">Suppressed</span><div class="v">' + U.n(supp) + '</div><small>profiles (hard bounce / manual)</small></div></div><div id="delivChart"></div><p class="hint" style="margin:8px 0 0">Thresholds: bounces &lt; 1%, complaints &lt; 0.08%, unsubscribes &lt; 0.5% per send. Simulated values.</p>';
    var bm = ms.map(function (m) { var a = U.parseYmd(m + '-01'), b = U.addMonths(a, 1) - 1; return E.period(a, b); });
    C.line(page.querySelector('#delivChart'), { labels: ms.map(U.ymLabel), height: 150, fmt: function (v) { return U.pct(v, 2); }, yfmt: function (v) { return (v * 100).toFixed(1) + '%'; }, aria: 'Bounce and unsubscribe rate by month',
      series: [{ name: 'Bounce rate', color: 'var(--c-clay)', values: bm.map(function (p) { return p.bounceRate; }) }, { name: 'Unsubscribe rate', color: 'var(--c-blue)', values: bm.map(function (p) { return p.unsubRate; }) }] });

    var camps = db.campaigns.filter(function (c) { return c.status === 'sent' && c.sentAt >= rg[0] && c.sentAt <= rg[1]; }).map(function (c) { return { c: c, s: E.cStats(c) }; }).sort(function (a, b) { return b.s.revenue - a.s.revenue; }).slice(0, 6);
    page.querySelector('#topC').innerHTML = camps.length ? C.hbars(camps.map(function (x) { return { label: x.c.name, href: (x.c.channel === 'sms' ? '#/sms/' : '#/campaigns/') + x.c.id, sub: U.date(x.c.sentAt) + ' · ' + (x.c.channel === 'sms' ? U.pct(x.s.clickRate) + ' click' : U.pct(x.s.openRate) + ' open · ' + U.pct(x.s.clickRate, 2) + ' click'), v: x.s.revenue, color: x.c.channel === 'sms' ? COL.sms : COL.campaign }; }), U.money) : '<div class="empty">No campaigns sent in this period.</div>';
    var rr = refRevenue(rg[0], rg[1]);
    var flows = db.flows.map(function (f) { var x = rr['f:' + f.id] || { rev: 0, orders: 0 }; return { f: f, rev: x.rev, orders: x.orders }; }).filter(function (x) { return x.rev > 0 || x.f.status === 'live'; }).sort(function (a, b) { return b.rev - a.rev; }).slice(0, 6);
    page.querySelector('#topF').innerHTML = flows.length ? C.hbars(flows.map(function (x) { return { label: x.f.name, href: '#/flows/' + x.f.id, sub: x.f.status + ' · ' + U.plural(x.orders, 'order'), v: x.rev, color: COL.flow }; }), U.money) : '<div class="empty">No flow revenue in this period.</div>';

    var up = db.campaigns.filter(function (c) { return c.status === 'scheduled' || c.status === 'sending'; }).sort(function (a, b) { return E.sendTime(a) - E.sendTime(b); });
    var waiting = db.runs.length;
    page.querySelector('#upcoming').innerHTML = up.map(function (c) { return '<li><span class="typeic">' + ic(c.channel === 'sms' ? I.sms : I.mail) + '</span><div class="main"><a href="' + (c.channel === 'sms' ? '#/sms/' : '#/campaigns/') + c.id + '">' + esc(c.name) + '</a><div class="meta"><span>' + (c.schedule.type === 'smart' ? 'Smart send · ' : '') + esc(U.dateTime(E.sendTime(c))) + '</span><span>' + esc(UI.audienceText(c)) + '</span></div></div><div class="end">' + UI.status(c.status) + '</div></li>'; }).join('') +
      '<li><span class="typeic">' + ic(I.clock) + '</span><div class="main"><a href="#/flows">' + U.plural(waiting, 'profile') + ' waiting in flow delays</a><div class="meta">Processed automatically as the demo clock moves (fast-forward in the Event simulator).</div></div></li>';
    var tot = db.profiles.length, emailable = db.profiles.filter(E.canEmail).length, smsable = db.profiles.filter(E.canSms).length;
    page.querySelector('#aud').innerHTML = '<div class="tiles" style="padding:0 0 12px"><div class="tile"><span class="label">Profiles</span><div class="v">' + U.n(tot) + '</div></div><div class="tile"><span class="label">Email-reachable</span><div class="v">' + U.n(emailable) + '</div><small>' + U.pct(emailable / tot) + '</small></div><div class="tile"><span class="label">SMS-reachable</span><div class="v">' + U.n(smsable) + '</div><small>' + U.pct(smsable / tot) + '</small></div></div>' +
      C.hbars(db.lists.map(function (l) { return { label: l.name, href: '#/lists/' + l.id, v: l.members.length, color: 'var(--c-blue)' }; }));
    page.querySelector('.seg').addEventListener('click', function (e) { var b = e.target.closest('[data-period]'); if (b) { U.pref('period', b.dataset.period); App().render(true); } });
  }, 'dash');

  // ── Analytics ─────────────────────────────────────────────────────────
  var TABS = [['campaigns', 'Campaign comparison'], ['flows', 'Flow performance'], ['cohorts', 'Subscriber cohorts'], ['attribution', 'Attribution settings'], ['export', 'Export CSV']];
  AM.route(/^\/analytics(?:\/(\w+))?$/, function (page, m) {
    var tab = m[1] || 'campaigns';
    App().title = 'Analytics';
    page.innerHTML = UI.head({ title: 'Analytics', dot: true, sub: 'Compare campaigns and flows, follow subscriber cohorts, tune attribution and export results. All figures are simulated.' }) +
      '<nav class="seg" aria-label="Analytics sections" style="margin-bottom:16px">' + TABS.map(function (t) { return '<a href="#/analytics/' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</nav><div id="an"></div>';
    var box = page.querySelector('#an');
    ({ campaigns: anCampaigns, flows: anFlows, cohorts: anCohorts, attribution: anAttr, export: anExport }[tab] || anCampaigns)(box);
  }, 'analytics');

  function campaignRows() {
    return E.db().campaigns.filter(function (c) { return c.status === 'sent'; }).map(function (c) { return { c: c, s: E.cStats(c) }; });
  }
  App.campaignCsv = function (rows) {
    return U.csv([['id', 'name', 'channel', 'sent_at', 'audience', 'recipients', 'delivered', 'bounces', 'unique_opens', 'open_rate', 'unique_clicks', 'click_rate', 'click_to_open', 'unsubscribes', 'spam_complaints', 'attributed_orders', 'attributed_revenue_eur', 'revenue_per_recipient', 'ab_winner']].concat(rows.map(function (x) {
      var c = x.c, s = x.s; return [c.id, c.name, c.channel, new Date(c.sentAt).toISOString(), UI.audienceText(c), s.recipients, s.delivered, s.bounce, s.open, s.openRate.toFixed(4), s.click, s.clickRate.toFixed(4), s.ctor.toFixed(4), s.unsub, s.spam, s.orders, s.revenue.toFixed(2), s.rpr.toFixed(3), c.st && c.st.ab ? c.st.ab.winner : ''];
    })));
  };
  function anCampaigns(box) {
    var st = AM.App.state.an || (AM.App.state.an = { sort: 'sentAt', dir: -1, ch: 'all', q: '' });
    var cols = [['name', 'Campaign'], ['sentAt', 'Sent'], ['recipients', 'Recipients', 1], ['openRate', 'Open rate', 1], ['clickRate', 'Click rate', 1], ['ctor', 'CTOR', 1], ['unsubRate', 'Unsub.', 1], ['orders', 'Orders', 1], ['revenue', 'Revenue', 1], ['rpr', 'Rev / recipient', 1]];
    var draw = function () {
      var rows = campaignRows().filter(function (x) { return (st.ch === 'all' || x.c.channel === st.ch) && U.matchQ(st.q, x.c.name); });
      rows.sort(function (a, b) { var va = st.sort === 'name' ? a.c.name : st.sort === 'sentAt' ? a.c.sentAt : a.s[st.sort], vb = st.sort === 'name' ? b.c.name : st.sort === 'sentAt' ? b.c.sentAt : b.s[st.sort]; return (va > vb ? 1 : va < vb ? -1 : 0) * st.dir; });
      var tot = rows.reduce(function (a, x) { a.r += x.s.recipients; a.o += x.s.orders; a.v += x.s.revenue; return a; }, { r: 0, o: 0, v: 0 });
      box.querySelector('#ctbl').innerHTML = '<table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th' + (c[2] ? ' class="r"' : '') + ' aria-sort="' + (st.sort === c[0] ? (st.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="sortbtn" data-sort="' + c[0] + '">' + c[1] + (st.sort === c[0] ? '<i>' + (st.dir > 0 ? '↑' : '↓') + '</i>' : '') + '</button></th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (x) { var c = x.c, s = x.s, sms = c.channel === 'sms'; return '<tr><td><a class="t1" href="' + (sms ? '#/sms/' : '#/campaigns/') + c.id + '">' + esc(c.name) + '</a><small>' + (sms ? 'SMS' : 'Email') + (c.st && c.st.ab ? ' · A/B winner ' + c.st.ab.winner : '') + '</small></td><td class="num">' + esc(U.date(c.sentAt)) + '</td><td class="r num">' + U.n(s.recipients) + '</td><td class="r num">' + (sms ? '—' : U.pct(s.openRate)) + '</td><td class="r num">' + U.pct(s.clickRate, 2) + '</td><td class="r num">' + (sms ? '—' : U.pct(s.ctor)) + '</td><td class="r num">' + U.pct(s.unsubRate, 2) + '</td><td class="r num">' + U.n(s.orders) + '</td><td class="r num">' + U.money(s.revenue) + '</td><td class="r num">' + U.money2(s.rpr) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td>' + U.plural(rows.length, 'campaign') + '</td><td></td><td class="r num">' + U.n(tot.r) + '</td><td></td><td></td><td></td><td></td><td class="r num">' + U.n(tot.o) + '</td><td class="r num">' + U.money(tot.v) + '</td><td class="r num">' + U.money2(tot.r ? tot.v / tot.r : 0) + '</td></tr></tfoot></table>';
      var last = rows.slice().sort(function (a, b) { return a.c.sentAt - b.c.sentAt; }).slice(-14);
      C.bars(box.querySelector('#cchart'), { labels: last.map(function (x) { return U.dateShort(x.c.sentAt); }), fmt: function (v) { return U.pct(v, 1); }, yfmt: function (v) { return (v * 100).toFixed(0) + '%'; }, aria: 'Open and click rate of recent campaigns', series: [{ name: 'Open rate', color: COL.campaign, values: last.map(function (x) { return x.s.openRate; }) }, { name: 'Click rate', color: COL.flow, values: last.map(function (x) { return x.s.clickRate; }) }] });
    };
    box.innerHTML = '<section class="card"><div class="card-h"><h2>Open and click rate — most recent campaigns in view</h2></div><div class="chart" id="cchart"></div></section>' +
      '<section class="card mt"><div class="card-h"><div class="toolbar" style="margin:0"><label class="sr" for="anQ">Search campaigns</label><input class="search" id="anQ" type="search" placeholder="Search campaigns…" value="' + esc(st.q) + '"><div class="seg" role="group" aria-label="Channel">' + [['all', 'All'], ['email', 'Email'], ['sms', 'SMS']].map(function (c) { return '<button type="button" data-ch="' + c[0] + '" aria-pressed="' + (st.ch === c[0]) + '">' + c[1] + '</button>'; }).join('') + '</div></div>' +
      '<button type="button" class="btn sm" id="anCsv">' + ic(I.download) + 'Export CSV</button></div><div class="tablewrap" id="ctbl"></div></section>';
    draw();
    box.addEventListener('click', function (e) {
      var s = e.target.closest('[data-sort]'); if (s) { if (st.sort === s.dataset.sort) st.dir *= -1; else { st.sort = s.dataset.sort; st.dir = s.dataset.sort === 'name' ? 1 : -1; } draw(); }
      var ch = e.target.closest('[data-ch]'); if (ch) { st.ch = ch.dataset.ch; U.$$('[data-ch]', box).forEach(function (b) { b.setAttribute('aria-pressed', String(b === ch)); }); draw(); }
      if (e.target.closest('#anCsv')) { U.download('adrial-mail-campaign-results.csv', App().campaignCsv(campaignRows())); U.toast('CSV exported (generated locally).'); }
    });
    box.querySelector('#anQ').addEventListener('input', U.debounce(function (e) { st.q = e.target.value; draw(); }, 150));
  }
  function flowRows() { return E.db().flows.map(function (f) { return { f: f, s: E.flowStats(f) }; }); }
  App.flowCsv = function () {
    var rows = [['flow_id', 'flow', 'status', 'trigger', 'step_id', 'step', 'type', 'entered', 'sent', 'skipped', 'unique_opens', 'open_rate', 'unique_clicks', 'click_rate', 'orders', 'revenue_eur']];
    E.db().flows.forEach(function (f) { E.walk(f.steps, function (s) { var x = E.stepStats(f, s); rows.push([f.id, f.name, f.status, E.triggerText(f.trigger), s.id, s.name || E.STEPS[s.type].label, s.type, x.entered, x.sent, x.skipped, x.open, x.openRate.toFixed(4), x.click, x.clickRate.toFixed(4), x.orders, x.revenue.toFixed(2)]); }); });
    return U.csv(rows);
  };
  function anFlows(box) {
    var rows = flowRows().sort(function (a, b) { return b.s.revenue - a.s.revenue; });
    box.innerHTML = '<section class="card"><div class="card-h"><h2>Revenue by flow (all time)</h2><button type="button" class="btn sm" id="fCsv">' + ic(I.download) + 'Export step CSV</button></div><div class="card-b">' + C.hbars(rows.map(function (x) { return { label: x.f.name, href: '#/flows/' + x.f.id, sub: E.triggerText(x.f.trigger), v: x.s.revenue, color: COL.flow }; }), U.money) + '</div></section>' +
      '<section class="card mt"><div class="tablewrap"><table class="tbl"><thead><tr><th>Flow</th><th>Status</th><th class="r">Entered</th><th class="r">Waiting</th><th class="r">Emails</th><th class="r">SMS</th><th class="r">Open rate</th><th class="r">Click rate</th><th class="r">Orders</th><th class="r">Revenue</th><th class="r">Rev / recipient</th></tr></thead><tbody>' +
      rows.map(function (x) { var s = x.s; return '<tr><td><a class="t1" href="#/flows/' + x.f.id + '">' + esc(x.f.name) + '</a><small>' + esc(E.triggerText(x.f.trigger)) + '</small></td><td>' + UI.status(x.f.status) + '</td><td class="r num">' + U.n(s.entered) + '</td><td class="r num">' + U.n(s.waiting) + '</td><td class="r num">' + U.n(s.emailSent) + '</td><td class="r num">' + U.n(s.smsSent) + '</td><td class="r num">' + U.pct(s.openRate) + '</td><td class="r num">' + U.pct(s.clickRate, 2) + '</td><td class="r num">' + U.n(s.orders) + '</td><td class="r num">' + U.money(s.revenue) + '</td><td class="r num">' + U.money2(s.rpr) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    box.querySelector('#fCsv').addEventListener('click', function () { U.download('adrial-mail-flow-steps.csv', App().flowCsv()); U.toast('CSV exported (generated locally).'); });
  }
  function anCohorts(box) {
    var metric = AM.App.state.cohort || 'subscribed';
    var db = E.db(), now = E.now(), ms = monthsBack(12), N = 12;
    var rows = ms.map(function (m) { return { m: m, size: 0, cells: new Array(N).fill(0) }; }), idxOf = {}; ms.forEach(function (m, i) { idxOf[m] = i; });
    db.profiles.forEach(function (p) {
      var ci = idxOf[U.ym(p.created)]; if (ci == null) return;
      var row = rows[ci]; row.size++;
      var ev = E.events(p.id), unsubAt = null, orderM = {}, openM = {}, first = U.monthStart(p.created);
      ev.forEach(function (e) {
        if (e.t === 'unsub' && e.x !== 'sms' && !unsubAt) unsubAt = e.ts; if (e.t === 'spam' && !unsubAt) unsubAt = e.ts;
        var k = Math.round((U.monthStart(e.ts) - first) / (30.44 * DAY)); if (k < 0 || k >= N) return;
        if (e.t === 'order') orderM[k] = 1; if (e.t === 'open' || e.t === 'click') openM[k] = 1;
      });
      var everOrdered = false;
      for (var k = 0; k < N; k++) {
        var mEnd = U.addMonths(first, k + 1) - 1; if (U.addMonths(first, k) > now) break;
        if (orderM[k]) everOrdered = true;
        var v = metric === 'subscribed' ? (p.em.s !== 'never' && (!unsubAt || unsubAt > mEnd) ? 1 : 0) : metric === 'ordered' ? (everOrdered ? 1 : 0) : (openM[k] ? 1 : 0);
        row.cells[k] += v;
      }
    });
    var shade = function (v) { return 'background:color-mix(in srgb, var(--accent) ' + Math.round(8 + v * 62) + '%, transparent)'; };
    box.innerHTML = '<section class="card"><div class="card-h"><div><span class="label">Signup month × months since signup</span><h2>Subscriber cohorts</h2></div><div class="seg" role="group" aria-label="Cohort metric">' + [['subscribed', '% still subscribed'], ['ordered', '% ordered (cumulative)'], ['engaged', '% opened or clicked']].map(function (x) { return '<button type="button" data-coh="' + x[0] + '" aria-pressed="' + (metric === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="tablewrap"><table class="tbl cohort"><thead><tr><th>Cohort</th><th class="r">Profiles</th>' + rows.map(function (r, k) { return '<th class="r">M' + k + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, ri) { return '<tr><td>' + esc(U.ymLabel(r.m)) + '</td><td>' + U.n(r.size) + '</td>' + r.cells.map(function (c, k) { if (k > N - 1 - ri) return '<td></td>'; var v = r.size ? c / r.size : 0; return '<td><span class="heat" style="' + shade(v) + '">' + (v * 100).toFixed(0) + '%</span></td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div><div class="card-b"><p class="hint" style="margin:8px 0 0">Profiles created in each month; M0 is the signup month. "Still subscribed" counts profiles who opted in to email and had not unsubscribed or complained by the end of that month.</p></div></section>';
    box.querySelector('.seg').addEventListener('click', function (e) { var b = e.target.closest('[data-coh]'); if (b) { AM.App.state.cohort = b.dataset.coh; anCohorts(box); } });
  }
  function anAttr(box) {
    var db = E.db(), s = db.settings;
    var calc = function (o, c, sm) {
      var keep = { openWin: s.openWin, clickWin: s.clickWin, smsWin: s.smsWin };
      s.openWin = o; s.clickWin = c; s.smsWin = sm; E.touch();
      var now = E.now(), p = E.period(now - 365 * DAY, now);
      Object.assign(s, keep); E.touch();
      return p;
    };
    var draw = function () {
      var o = +box.querySelector('#aOpen').value, c = +box.querySelector('#aClick').value, sm = +box.querySelector('#aSms').value;
      box.querySelector('#aOpenV').textContent = o + ' days'; box.querySelector('#aClickV').textContent = c + ' days'; box.querySelector('#aSmsV').textContent = sm + ' days';
      var p = calc(o, c, sm), base = calc(s.openWin, s.clickWin, s.smsWin);
      box.querySelector('#aRes').innerHTML = '<div class="tiles" style="padding:0">' + [['Attributed revenue', p.revenue, base.revenue], ['Campaigns', p.campaignRev, base.campaignRev], ['Flows', p.flowRev, base.flowRev], ['SMS', p.smsRev, base.smsRev]].map(function (x) { return '<div class="tile"><span class="label">' + x[0] + '</span><div class="v">' + U.money(x[1]) + '</div><small>' + (x[1] === x[2] ? 'current setting' : (x[1] > x[2] ? '+' : '') + U.money(x[1] - x[2]) + ' vs saved') + '</small></div>'; }).join('') + '</div><p class="hint" style="margin:10px 0 0">Last 12 months · ' + U.pct(p.totalRev ? p.revenue / p.totalRev : 0) + ' of ' + U.money(p.totalRev) + ' total store revenue would be attributed to messaging.</p>';
    };
    var slider = function (id, label, v, max) { return '<div class="field"><label for="' + id + '">' + label + ' — <b id="' + id + 'V" style="font-weight:500;color:var(--ink)"></b></label><input type="range" id="' + id + '" min="0" max="' + max + '" value="' + v + '"></div>'; };
    box.innerHTML = '<div class="grid2"><section class="card"><div class="card-h"><h2>Attribution model</h2></div><div class="card-b stack" style="gap:14px">' +
      '<p style="margin:0;color:var(--ink2)">An order is credited to the most recent message the customer <b style="font-weight:500">clicked</b> (email or SMS) within the click window. If there was no click, it goes to the most recent email they <b style="font-weight:500">opened</b> within the open window. Orders without either are not attributed.</p>' +
      slider('aOpen', 'Email open window', s.openWin, 30) + slider('aClick', 'Email click window', s.clickWin, 30) + slider('aSms', 'SMS click window', s.smsWin, 14) +
      '<div class="actions"><button type="button" class="btn pri" id="aSave">Save attribution settings</button><button type="button" class="btn" id="aDef">Defaults (5 / 5 / 1)</button></div></div></section>' +
      '<section class="card"><div class="card-h"><h2>Impact preview</h2></div><div class="card-b" id="aRes"></div></section></div>';
    draw();
    box.addEventListener('input', function (e) { if (e.target.type === 'range') draw(); });
    box.querySelector('#aDef').addEventListener('click', function () { box.querySelector('#aOpen').value = 5; box.querySelector('#aClick').value = 5; box.querySelector('#aSms').value = 1; draw(); });
    box.querySelector('#aSave').addEventListener('click', function () {
      s.openWin = +box.querySelector('#aOpen').value; s.clickWin = +box.querySelector('#aClick').value; s.smsWin = +box.querySelector('#aSms').value;
      E.touch(); App().save(['settings']); draw(); U.toast('Attribution settings saved — all revenue figures recalculated.');
    });
  }
  App.profilesCsv = function (ids) {
    var rows = [['id', 'first_name', 'last_name', 'email', 'phone', 'country', 'language', 'city', 'source', 'created', 'email_consent', 'sms_consent', 'suppressed', 'lists', 'orders', 'spent_eur', 'predicted_clv_eur', 'churn_risk', 'next_order']];
    ids.forEach(function (id) { var p = E.profile(id); if (!p) return; var pr = E.pred(p); rows.push([p.id, p.first, p.last, p.email, p.phone, p.country, p.lang, p.city, p.source, new Date(p.created).toISOString(), p.em.s, p.sms.s, p.sup ? p.sup.r : '', E.profileLists(p.id).map(function (l) { return l.name; }).join('; '), pr.orders, pr.spent.toFixed(2), pr.clv, pr.churn, pr.next ? U.ymd(pr.next) : '']); });
    return U.csv(rows);
  };
  function anExport(box) {
    var db = E.db();
    var opt = '<option value="all">All profiles (' + U.n(db.profiles.length) + ')</option>' + db.lists.map(function (l) { return '<option value="l' + l.id + '">List · ' + esc(l.name) + ' (' + U.n(l.members.length) + ')</option>'; }).join('') + db.segments.map(function (s) { return '<option value="s' + s.id + '">Segment · ' + esc(s.name) + '</option>'; }).join('');
    box.innerHTML = '<div class="grid2 even"><section class="card"><div class="card-h"><h2>Profiles, lists and segments</h2></div><div class="card-b stack" style="gap:12px"><div class="field"><label for="exWhat">Which profiles</label><select class="in" id="exWhat">' + opt + '</select></div><button type="button" class="btn pri" id="exP">' + ic(I.download) + 'Export profiles CSV</button>' +
      '<button type="button" class="btn" id="exS">' + ic(I.download) + 'Export segment definitions + sizes</button></div></section>' +
      '<section class="card"><div class="card-h"><h2>Results</h2></div><div class="card-b stack" style="gap:12px"><button type="button" class="btn" id="exC">' + ic(I.download) + 'Campaign results CSV</button><button type="button" class="btn" id="exF">' + ic(I.download) + 'Flow step results CSV</button><button type="button" class="btn" id="exE">' + ic(I.download) + 'Events CSV (last 30 days)</button><p class="hint" style="margin:0">Files are generated in this browser from the demo data; nothing is uploaded.</p></div></section></div>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.id === 'exP') { var v = box.querySelector('#exWhat').value, ids = v === 'all' ? db.profiles.map(function (p) { return p.id; }) : v[0] === 'l' ? E.list(v.slice(1)).members : Array.from(E.segSet(E.segment(v.slice(1)))); U.download('adrial-mail-profiles-' + v + '.csv', App().profilesCsv(ids)); U.toast(U.plural(ids.length, 'profile') + ' exported.'); }
      if (b.id === 'exS') { U.download('adrial-mail-segments.csv', U.csv([['id', 'name', 'description', 'definition', 'profiles']].concat(db.segments.map(function (s) { return [s.id, s.name, s.desc || '', E.defText(s.def), E.segSet(s).size]; })))); U.toast('Segments exported.'); }
      if (b.id === 'exC') { U.download('adrial-mail-campaign-results.csv', App().campaignCsv(campaignRows())); U.toast('Campaign results exported.'); }
      if (b.id === 'exF') { U.download('adrial-mail-flow-steps.csv', App().flowCsv()); U.toast('Flow results exported.'); }
      if (b.id === 'exE') { var from = E.now() - 30 * DAY; U.download('adrial-mail-events-30d.csv', U.csv([['timestamp', 'profile_id', 'event', 'product', 'value_eur', 'message']].concat(db.events.filter(function (x) { return x.ts >= from; }).map(function (x) { return [new Date(x.ts).toISOString(), x.p, E.EVENTS[x.t] || x.t, x.s || '', x.v || '', typeof x.r === 'string' ? E.refName(x.r) : '']; })))); U.toast('Events exported.'); }
    });
  }

  // ── Event simulator ───────────────────────────────────────────────────
  var SIM_EVENTS = [['view', 'Viewed product'], ['cart', 'Added to cart'], ['checkout', 'Started checkout'], ['order', 'Placed order'], ['price_drop', 'Price drop (on a viewed item)'], ['bis', 'Back in stock'], ['open', 'Opened email'], ['click', 'Clicked email'], ['sub', 'Subscribed to list'], ['unsub', 'Unsubscribed (email)']];
  AM.route(/^\/simulator$/, function (page) {
    App().title = 'Event simulator';
    var st = AM.App.state; st.simLog = st.simLog || [];
    var db = E.db();
    if (!st.simP || !E.profile(st.simP)) st.simP = 1;
    var p = E.profile(st.simP);
    page.innerHTML = UI.head({ title: 'Event simulator', dot: true, sub: 'A demo helper: fire events for one profile and watch flows, segments and predictions react in real time. No email or SMS is sent.' }) +
      '<div class="banner demo" style="margin-bottom:16px">' + ic(I.zap) + '<span>Demo tool. Events are written to this browser\'s demo database only. Flows that are <b style="font-weight:500">Live</b> or <b style="font-weight:500">Manual</b> react; time delays wait for the demo clock — fast-forward it below.</span></div>' +
      '<div class="grid2"><div class="stack"><section class="card"><div class="card-h"><h2>1 · Pick a profile</h2><button type="button" class="btn sm" id="simNew">' + ic(I.plus) + 'New test profile</button></div><div class="card-b">' + UI.picker('simPick', 'Profile', st.simP) + '<div id="simProf" style="margin-top:12px"></div></div></section>' +
      '<section class="card"><div class="card-h"><h2>2 · Fire an event</h2></div><div class="card-b stack" style="gap:12px" id="simForm"></div></section>' +
      '<section class="card"><div class="card-h"><h2>Quick scenarios</h2></div><div class="card-b actions"><button type="button" class="btn" data-sc="abandon">Abandon a cart</button><button type="button" class="btn" data-sc="browse">Browse sunglasses</button><button type="button" class="btn" data-sc="lens">Buy contact lenses</button><button type="button" class="btn" data-sc="buy">Buy frames</button><button type="button" class="btn" data-sc="engage">Open + click newsletter</button></div></section></div>' +
      '<div class="stack"><section class="card"><div class="card-h"><div><span class="label">Demo clock</span><h2 id="simClock"></h2></div></div><div class="card-b stack" style="gap:10px"><div class="actions"><button type="button" class="btn" data-ff="3600000">+1 hour</button><button type="button" class="btn" data-ff="14400000">+4 hours</button><button type="button" class="btn" data-ff="86400000">+1 day</button><button type="button" class="btn" data-ff="604800000">+1 week</button><button type="button" class="btn pri" id="simFF">Fast-forward this profile\'s delays</button></div><p class="hint" style="margin:0">Moving the clock processes waiting flow steps, date-triggered flows (birthdays, eye-exam dates) and scheduled campaigns.</p><div id="simRuns"></div></div></section>' +
      '<section class="card"><div class="card-h"><h2>Activity log</h2><button type="button" class="btn sm ghost" id="simClear">Clear</button></div><ul class="log" id="simLog"></ul></section></div></div>';
    var prodOpts = function (cat) { return db.products.filter(function (x) { return !cat || x.category === cat; }).map(function (x) { return '<option value="' + esc(x.sku) + '">' + esc(x.name + ' · ' + x.category + ' · ' + U.money2(x.price)) + '</option>'; }).join(''); };
    var form = page.querySelector('#simForm');
    var drawForm = function () {
      var t = st.simT || 'checkout';
      form.innerHTML = '<div class="row2"><div class="field"><label for="simT">Event</label><select class="in" id="simT">' + SIM_EVENTS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === t ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
        (['view', 'cart', 'checkout', 'order', 'price_drop', 'bis'].indexOf(t) >= 0 ? '<div class="field"><label for="simS">Product</label><select class="in" id="simS">' + prodOpts() + '</select></div>' : t === 'sub' ? '<div class="field"><label for="simL">List</label><select class="in" id="simL">' + db.lists.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + '</option>'; }).join('') + '</select></div>' : (t === 'open' || t === 'click') ? '<div class="field"><label for="simM">Message</label><select class="in" id="simM">' + db.campaigns.filter(function (c) { return c.status === 'sent' && c.channel === 'email'; }).slice().reverse().map(function (c) { return '<option value="c:' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select></div>' : '<div></div>') + '</div>' +
        '<button type="button" class="btn pri" id="simFire">' + ic(I.zap) + 'Fire event</button>';
      if (st.simS && form.querySelector('#simS')) form.querySelector('#simS').value = st.simS;
    };
    var drawProf = function () {
      p = E.profile(st.simP); var pr = E.pred(p);
      var segs = E.profileSegments(p), lists = E.profileLists(p.id);
      page.querySelector('#simProf').innerHTML = '<div class="who">' + UI.avatar(p, true) + '<span class="nm"><b><a class="t1" href="#/profiles/' + p.id + '">' + esc(E.fullName(p)) + '</a></b><small>' + esc(p.email + ' · ' + p.country + ' · ' + p.lang.toUpperCase()) + '</small></span></div>' +
        '<div class="actions" style="margin-top:10px">Email ' + UI.consent(p, 'email') + ' SMS ' + UI.consent(p, 'sms') + '</div>' +
        '<div class="counter" style="margin-top:10px"><span>Orders <b>' + pr.orders + '</b></span><span>Spent <b>' + U.money(pr.spent) + '</b></span><span>CLV <b>' + U.money(pr.clv) + '</b></span><span>Churn <b>' + pr.churn + '</b></span></div>' +
        '<p class="label" style="margin:12px 0 6px">Lists</p><div class="actions">' + (lists.map(function (l) { return '<span class="chip">' + esc(l.name) + '</span>'; }).join('') || '<span class="muted">none</span>') + '</div>' +
        '<p class="label" style="margin:12px 0 6px">Segments (live)</p><div class="actions">' + (segs.map(function (s) { return '<span class="chip tone tone-violet">' + esc(s.name) + '</span>'; }).join('') || '<span class="muted">none</span>') + '</div>';
      var runs = db.runs.filter(function (r) { return r.p === p.id && !r.done; });
      var now = E.now();
      page.querySelector('#simClock').textContent = U.dateTime(now) + (db.meta.clockOffset ? ' (+' + U.short(db.meta.clockOffset / U.HOUR) + ' h)' : '');
      page.querySelector('#simRuns').innerHTML = '<p class="label" style="margin:4px 0 6px">' + U.plural(runs.length, 'waiting flow run') + ' for this profile · ' + U.n(db.runs.length) + ' in total</p>' + (runs.length ? '<ul class="rows" style="border:1px solid var(--hair);border-radius:14px">' + runs.map(function (r) { var f = E.flow(r.f), loc = f ? E.findStep(f.steps, r.sid) : null; return '<li><div class="main"><a href="#/flows/' + r.f + '">' + esc(f ? f.name : 'Flow') + '</a><div class="meta">Next: ' + esc(loc ? loc.step.name || E.STEPS[loc.step.type].label : 'end') + '</div></div><div class="end"><span class="hint">' + (r.wake ? esc(U.ago(r.wake, now)) : 'now') + '</span></div></li>'; }).join('') + '</ul>' : '');
      App().navCounts();
    };
    var drawLog = function () {
      page.querySelector('#simLog').innerHTML = st.simLog.length ? st.simLog.slice(0, 80).map(function (l) { return '<li style="--c:' + (l.c || 'var(--line)') + '">' + l.h + '<small>' + esc(U.dateTime(l.ts)) + '</small></li>'; }).join('') : '<li>Nothing yet — fire an event to see what happens.</li>';
    };
    var log = function (h, c) { st.simLog.unshift({ h: h, ts: E.now(), c: c }); };
    var segBefore;
    var snapshot = function () { return new Set(E.profileSegments(E.profile(st.simP)).map(function (s) { return s.id; })); };
    var fire = function (evs) {
      segBefore = snapshot();
      var runsBefore = new Set(db.runs.map(function (r) { return r.id; }));
      var flows = [];
      evs.forEach(function (ev) {
        var res;
        if (ev.t === 'sub') { res = E.addToList(ev.r, ev.p, { live: true }); log('Added to list <b>' + esc(E.list(ev.r).name) + '</b>', 'var(--c-teal)'); }
        else { res = E.addEvent(ev, { live: true }); log('Fired <b>' + esc(E.EVENTS[ev.t]) + '</b>' + (ev.s ? ' · ' + esc(E.product(ev.s).name) : '') + (ev.v ? ' · ' + U.money2(ev.v) : ''), 'var(--c-blue)'); }
        (res || []).forEach(function (x) { flows.push(x); });
      });
      flows.forEach(function (x) {
        if (!x.run) { log('Flow <a href="#/flows/' + x.flow.id + '">' + esc(x.flow.name) + '</a>: not entered (re-entry rule or trigger filter)', 'var(--c-grey)'); return; }
        (x.run.log || []).forEach(function (l) { log('<a href="#/flows/' + x.flow.id + '">' + esc(x.flow.name) + '</a> · ' + esc(l.m), 'var(--accent)'); });
        if (!x.run.done && x.run.wake) log('<a href="#/flows/' + x.flow.id + '">' + esc(x.flow.name) + '</a> · waiting until ' + esc(U.dateTime(x.run.wake)), 'var(--accent)');
        x.run.logShown = (x.run.log || []).length;
      });
      afterChange(runsBefore);
    };
    var afterChange = function () {
      var after = snapshot();
      after.forEach(function (id) { if (!segBefore.has(id)) log('Now matches segment <a href="#/segments/' + id + '">' + esc(E.segment(id).name) + '</a>', 'var(--c-green)'); });
      segBefore.forEach(function (id) { if (!after.has(id)) log('No longer in segment <a href="#/segments/' + id + '">' + esc(E.segment(id).name) + '</a>', 'var(--c-clay)'); });
      App().save(['events', 'profiles', 'lists', 'runs', 'flows', 'meta']);
      drawProf(); drawLog();
    };
    var advance = function (ms) {
      segBefore = snapshot();
      var watch = db.runs.filter(function (r) { return r.p === st.simP; });
      watch.forEach(function (r) { r.log = r.log || []; r.logShown = r.log.length; });
      var res = App().advanceClock(ms);
      log('Demo clock moved +' + (ms >= DAY ? U.plural(Math.round(ms / DAY), 'day') : U.plural(Math.round(ms / U.HOUR), 'hour')) + (res.moved.length ? ' · ' + U.plural(res.moved.length, 'flow run') + ' advanced' : '') + (res.dated ? ' · ' + res.dated + ' date-triggered entries' : '') + (res.sent.length ? ' · ' + res.sent.length + ' scheduled campaign(s) sent' : ''), 'var(--c-grey)');
      watch.forEach(function (r) { var f = E.flow(r.f); (r.log || []).slice(r.logShown).forEach(function (l) { log('<a href="#/flows/' + r.f + '">' + esc(f ? f.name : 'Flow') + '</a> · ' + esc(l.m), 'var(--accent)'); }); r.logShown = (r.log || []).length; });
      afterChange();
    };
    drawForm(); drawProf(); drawLog();
    UI.wirePicker(page, 'simPick', function (pp) { st.simP = pp.id; drawProf(); });
    form.addEventListener('change', function (e) { if (e.target.id === 'simT') { st.simT = e.target.value; drawForm(); } if (e.target.id === 'simS') st.simS = e.target.value; });
    page.addEventListener('click', function (e) {
      var now = E.now(), pid = st.simP, b;
      if (e.target.closest('#simFire')) {
        var t = form.querySelector('#simT').value, ev = { p: pid, t: t, ts: now };
        var sEl = form.querySelector('#simS'); if (sEl) { ev.s = sEl.value; var pr = E.product(ev.s); if (t === 'order' || t === 'checkout' || t === 'cart') ev.v = E.orderValue(pr, Math.random, E.profile(pid)); }
        if (t === 'sub') ev.r = +form.querySelector('#simL').value;
        if (t === 'open' || t === 'click') { ev.r = form.querySelector('#simM').value; if (t === 'click') { var c = E.campaign(ev.r.split(':')[1]); ev.x = (E.linkIds(c.design)[0]) || 'link'; } }
        if (t === 'unsub') ev.x = 'email';
        fire([ev]);
      }
      if ((b = e.target.closest('[data-sc]'))) {
        var sc = b.dataset.sc, P = function (cat) { var pool = db.products.filter(function (x) { return x.category === cat; }); return pool.length ? pool[Math.floor(Math.random() * pool.length)] : db.products[0]; };
        var x;
        if (sc === 'abandon') { x = P('Frames'); fire([{ p: pid, t: 'view', ts: now - 120e3, s: x.sku }, { p: pid, t: 'cart', ts: now - 60e3, s: x.sku, v: x.price }, { p: pid, t: 'checkout', ts: now, s: x.sku, v: x.price }]); }
        if (sc === 'browse') { fire([0, 1, 2].map(function (k) { var y = P('Sunglasses'); return { p: pid, t: 'view', ts: now - (2 - k) * 60e3, s: y.sku }; })); }
        if (sc === 'lens') { x = P('Contact lenses'); var pp = E.profile(pid); if (!pp.props.lens_supply_days) { pp.props.lens_supply_days = 30; log('Set lens_supply_days = 30 on the profile (needed by the reorder flow)', 'var(--c-grey)'); } fire([{ p: pid, t: 'checkout', ts: now - 30e3, s: x.sku, v: E.orderValue(x, Math.random, pp) }, { p: pid, t: 'order', ts: now, s: x.sku, v: E.orderValue(x, Math.random, pp) }]); }
        if (sc === 'buy') { x = P('Frames'); fire([{ p: pid, t: 'view', ts: now - 300e3, s: x.sku }, { p: pid, t: 'checkout', ts: now - 30e3, s: x.sku, v: x.price }, { p: pid, t: 'order', ts: now, s: x.sku, v: x.price }]); }
        if (sc === 'engage') { var c2 = db.campaigns.filter(function (c) { return c.status === 'sent' && c.channel === 'email'; }).pop(); fire([{ p: pid, t: 'open', ts: now - 30e3, r: 'c:' + c2.id }, { p: pid, t: 'click', ts: now, r: 'c:' + c2.id, x: E.linkIds(c2.design)[0] || 'link' }]); }
      }
      if ((b = e.target.closest('[data-ff]'))) advance(+b.dataset.ff);
      if (e.target.closest('#simFF')) {
        var runs = db.runs.filter(function (r) { return r.p === pid && r.wake; });
        if (!runs.length) { U.toast('This profile has no waiting delays.'); return; }
        var target = Math.max.apply(null, runs.map(function (r) { return r.wake; }));
        advance(Math.max(60e3, target - E.now() + 60e3));
      }
      if (e.target.closest('#simClear')) { st.simLog = []; drawLog(); }
      if (e.target.closest('#simNew')) {
        var r = Math.random, si = r() < 0.5, F = si ? ['Ana', 'Nina', 'Luka', 'Rok', 'Maja'] : ['Ivana', 'Marko', 'Lucija', 'Josip', 'Ema'], L = si ? ['Testnik', 'Demo', 'Primer'] : ['Testić', 'Demić', 'Primjer'];
        var first = U.pick(r, F), last = U.pick(r, L);
        var np = E.createProfile({ first: first, last: last, email: U.deaccent(first + '.' + last).toLowerCase() + '.' + Math.floor(r() * 9000 + 1000) + (si ? '@example.si' : '@example.hr'), phone: (si ? '+386 00 5' : '+385 00 5') + Math.floor(r() * 90 + 10) + ' ' + Math.floor(r() * 900 + 100), country: si ? 'SI' : 'HR', lang: si ? 'sl' : 'hr', city: si ? 'Ljubljana' : 'Zagreb', smsConsent: true, source: 'Event simulator', eng: 0.8 });
        st.simP = np.id; log('Created test profile <a href="#/profiles/' + np.id + '">' + esc(E.fullName(np)) + '</a> (email + SMS consent)', 'var(--c-teal)');
        App().save(['profiles', 'meta']); App().render(true);
      }
    });
  }, 'simulator');
})();
