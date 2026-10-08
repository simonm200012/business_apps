/* Contracts: pages (overview, list, detail, calendar, reminders, spend) and SVG charts. */
(function () {
  'use strict';
  var CA = window.CA, X = CA.X, D = CA.D, esc = CA.esc, fmtD = CA.fmtD, opt = CA.opt, pill = CA.pill, TODAY = CA.TODAY;
  var ACT = CA.ACT = CA.ACT || {}, CHG = CA.CHG = CA.CHG || {}, INP = CA.INP = CA.INP || {};
  var cLink = function (c) { return '<a href="#/contracts/' + c.id + '">' + esc(c.name) + '</a>'; };
  var DEC_CLS = { undecided: 'warn', negotiation: '', renew: 'ok', renegotiate: '', cancel: 'bad' };
  var decPill = function (c) { return pill(DEC_CLS[c.decision] || '', X.DECISIONS[c.decision] || c.decision); };
  var statusPill = function (c) { return pill(c.status === 'active' ? 'ok' : c.status === 'ending' ? 'warn' : c.status === 'ended' ? 'na' : '', X.STATUSES[c.status]); };
  var TYPE_COL = { notice: 'bad', decide: 'bad', renewal: 'accent', end: 'mute', price: 'warn', decision: 'info', milestone: 'ok', start: 'ok' };
  var daysCls = function (d) { var n = CA.daysTo(d); return n <= 14 ? 'od' : n <= 45 ? 'soonc' : ''; };
  var all = function () { return CA.db.contracts; };
  var live = function (c) { return c.status === 'active' || c.status === 'ending'; };
  var eur = CA.eur;

  /* ---------- charts ---------- */
  function hbars(rows, label) {
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.max(r.a, r.b || 0); }).concat(1)), W = 700, lw = 190, rh = r2(rows), H = rows.length * rh + 8;
    function r2(rs) { return rs.some(function (r) { return r.b != null; }) ? 34 : 24; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(label) + '">';
    rows.forEach(function (r, i) {
      var y = 4 + i * rh, wa = (W - lw - 70) * r.a / mx;
      s += '<text x="' + (lw - 8) + '" y="' + (y + 15) + '" text-anchor="end">' + esc(r.t.length > 28 ? r.t.slice(0, 27) + '…' : r.t) + '</text><rect x="' + lw + '" y="' + y + '" width="' + Math.max(wa, 1) + '" height="16" rx="3" fill="var(--accent)"><title>' + esc(r.t + ': ' + eur(r.a)) + '</title></rect><text x="' + (lw + wa + 5) + '" y="' + (y + 13) + '" class="mute">' + eur(r.a) + '</text>';
      if (r.b != null) { var wb = (W - lw - 70) * r.b / mx; s += '<rect x="' + lw + '" y="' + (y + 17) + '" width="' + Math.max(wb, 1) + '" height="10" rx="3" fill="var(--warn)"><title>' + esc(r.t + ' next year: ' + eur(r.b)) + '</title></rect><text x="' + (lw + wb + 5) + '" y="' + (y + 26) + '" class="mute">' + eur(r.b) + '</text>'; }
    });
    return s + '</svg>';
  }
  function timelineCard(c) {
    var from = D.addDays(TODAY, -365), to = D.addDays(TODAY, 730), span = D.daysBetween(from, to), W = 700, H = 110;
    var ev = D.events(c, from, to, TODAY), x = function (d) { return 10 + (W - 20) * D.daysBetween(from, d) / span; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Timeline of dates for this contract"><line class="ax" x1="10" x2="' + (W - 10) + '" y1="60" y2="60"/>';
    for (var m = 0, d = from.slice(0, 8) + '01'; m <= 36; m += 3) { var dd = D.addMonths(d, m); if (dd >= from && dd <= to) s += '<line class="ax" x1="' + x(dd) + '" x2="' + x(dd) + '" y1="56" y2="64"/><text class="mute" x="' + x(dd) + '" y="78" text-anchor="middle">' + dd.slice(2, 7).replace('-', '/') + '</text>'; }
    s += '<line x1="' + x(TODAY) + '" x2="' + x(TODAY) + '" y1="20" y2="70" stroke="var(--accent)" stroke-dasharray="3 3"/><text x="' + x(TODAY) + '" y="14" text-anchor="middle" style="fill:var(--accent)">today</text>';
    ev.forEach(function (e, i) { var px = x(e.date), up = i % 2; s += '<g><circle cx="' + px + '" cy="60" r="5" fill="var(--ev-' + e.type + ')"><title>' + esc(fmtD(e.date) + ' ' + e.text) + '</title></circle><text x="' + px + '" y="' + (up ? 96 : 40) + '" text-anchor="' + (px > W - 90 ? 'end' : px < 90 ? 'start' : 'middle') + '">' + esc(e.text) + '</text></g>'; });
    return '<div class="card"><h2>Timeline</h2>' + s + '</svg><details class="tblv"><summary>Show as table</summary><table class="tbl">' + ev.map(function (e) { return '<tr><td>' + fmtD(e.date) + '</td><td>' + esc(e.text) + '</td></tr>'; }).join('') + '</table></details></div>';
  }

  /* ---------- overview ---------- */
  function pageOverview() {
    var cs = all().filter(live), wins = function (n) { return cs.filter(function (c) { var i = CA.info(c); return i.act && i.act.deadline >= TODAY && CA.daysTo(i.act.deadline) <= n; }); };
    var d30 = wins(30), d90 = wins(90).sort(function (a, b) { return CA.info(a).act.deadline < CA.info(b).act.deadline ? -1 : 1; });
    var y = +TODAY.slice(0, 4), now = 0, nxt = 0; all().forEach(function (c) { now += CA.info(c).annual; nxt += CA.projectYear(c, y + 1); });
    var byCat = X.CATEGORIES.map(function (k) { var a = 0; cs.forEach(function (c) { if (c.category === k.id) a += CA.info(c).annual; }); return { t: k.name, a: a }; }).sort(function (a, b) { return b.a - a.a; });
    var evs = []; all().forEach(function (c) { if (c.status === 'draft' || c.status === 'ended') return; D.events(c, TODAY, D.addDays(TODAY, 120), TODAY).forEach(function (e) { if (e.type === 'renewal' || e.type === 'end' || e.type === 'price') evs.push({ e: e, c: c }); }); });
    evs.sort(function (a, b) { return a.e.date < b.e.date ? -1 : 1; });
    var hk = [
      ['Contracts without a document', all().filter(function (c) { return live(c) && !c.docs.length; }).length, 'nodoc'],
      ['Undecided, deadline within 30 days', d30.filter(function (c) { return c.decision === 'undecided'; }).length, 'undec'],
      ['Drafts waiting to start', all().filter(function (c) { return c.status === 'draft'; }).length, 'draft'],
      ['Notice given, still running', all().filter(function (c) { return c.status === 'ending'; }).length, 'ending'],
      ['Renewals already locked in', cs.filter(function (c) { var n = CA.info(c).nd; return n && n.locked; }).length, 'locked']
    ];
    return '<div class="head"><div><h1>Overview</h1><p class="sub">Today is ' + fmtD(TODAY) + '. ' + all().length + ' fictional contracts for an optical retailer.</p></div><button class="btn pri" data-act="newc">New contract</button></div>' +
      '<div class="grid g4"><a class="card kpi" href="#/contracts"><b>' + cs.length + '</b><span>Running contracts</span></a><a class="card kpi ' + (d30.length ? 'bad' : '') + '" href="#/reminders"><b>' + d30.length + '</b><span>Deadlines in 30 days</span></a><a class="card kpi ' + (d90.length ? 'warn' : '') + '" href="#/calendar"><b>' + d90.length + '</b><span>Deadlines in 90 days</span></a><a class="card kpi" href="#/spend"><b>' + eur(now) + '</b><span>Spend per year, now</span></a><a class="card kpi" href="#/spend"><b>' + eur(nxt) + '</b><span>Expected in ' + (y + 1) + '</span></a></div>' +
      '<div class="card" style="margin-top:12px"><h2>Notice deadlines in the next 90 days</h2><div class="scroll"><table class="tbl"><tr><th>Deadline</th><th>Contract</th><th>Party</th><th>Decision</th><th>Annual</th></tr>' + (d90.length ? d90.map(function (c) { var i = CA.info(c); return '<tr><td><span class="' + daysCls(i.act.deadline) + '">' + fmtD(i.act.deadline) + '</span><div class="small mute">' + CA.rel(i.act.deadline) + '</div></td><td>' + cLink(c) + '<div class="small mute">' + esc(i.act.kind === 'decide' ? 'Extend or exit' : 'Notice') + '</div></td><td>' + esc(c.party) + '</td><td>' + decPill(c) + '</td><td>' + eur(i.annual) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="mute">No deadlines.</td></tr>') + '</table></div></div>' +
      '<div class="grid g2" style="margin-top:12px"><div class="card"><h2>Renewals, ends and price changes (120 days)</h2>' + (evs.length ? evs.slice(0, 14).map(function (x) { return '<div class="ev"><span class="dot" style="background:var(--ev-' + x.e.type + ')"></span><span class="small mute" style="width:78px">' + fmtD(x.e.date) + '</span> ' + cLink(x.c) + ' <span class="small mute">' + esc(x.e.text) + '</span></div>'; }).join('') + (evs.length > 14 ? '<p class="small mute">+' + (evs.length - 14) + ' more in the <a href="#/calendar">calendar</a></p>' : '') : '<p class="mute">Nothing in this window.</p>') + '</div>' +
      '<div class="card"><h2>Housekeeping</h2>' + hk.map(function (h) { return '<div class="row" style="justify-content:space-between;margin:6px 0"><span>' + h[0] + '</span>' + (h[1] ? '<a class="pill warn" href="#/contracts" data-act="hk" data-k="' + h[2] + '">' + h[1] + '</a>' : pill('ok', '0')) + '</div>'; }).join('') + '</div></div>' +
      '<div class="card" style="margin-top:12px"><h2>Annual value by category</h2>' + hbars(byCat.filter(function (r) { return r.a > 0; }), 'Annual value by category') + '<details class="tblv"><summary>Show as table</summary><table class="tbl">' + byCat.map(function (r) { return '<tr><td>' + esc(r.t) + '</td><td>' + eur(r.a) + '</td></tr>'; }).join('') + '</table></details></div>';
  }
  ACT.hk = function (el) {
    var L = CA.ui.list; L.q = ''; L.cat = ''; L.status = ''; L.decision = ''; L.company = ''; L.due = ''; L.page = 0; L.sort = 'deadline'; L.dir = 1;
    var k = el.dataset.k; if (k === 'undec') { L.decision = 'undecided'; L.due = '30'; } else if (k === 'draft') L.status = 'draft'; else if (k === 'ending') L.status = 'ending'; else if (k === 'nodoc') L.q = ':nodoc'; else if (k === 'locked') L.q = ':locked';
    CA.saveUi();
  };

  /* ---------- list ---------- */
  function hay(c) { return [c.id, c.name, c.party, CA.catName(c.category), c.company, c.location, c.notes, c.owner, c.contact && c.contact.name, c.contact && c.contact.email, c.iban, X.STATUSES[c.status], X.TYPES[c.type], X.DECISIONS[c.decision], c.docs.map(function (d) { return d.name; }).join(' ')].join(' ').toLowerCase(); }
  CA.filtered = function () {
    var f = CA.ui.list, q = f.q.toLowerCase().trim();
    var list = all().filter(function (c) {
      var i = CA.info(c);
      if (f.cat && c.category !== f.cat) return false; if (f.status && c.status !== f.status) return false; if (f.decision && c.decision !== f.decision) return false; if (f.company && c.company !== f.company) return false;
      if (f.due && !(i.act && i.act.deadline >= TODAY && CA.daysTo(i.act.deadline) <= +f.due)) return false;
      if (q === ':nodoc') return live(c) && !c.docs.length; if (q === ':locked') return live(c) && i.nd && i.nd.locked;
      return !q || q.split(/\s+/).every(function (w) { return hay(c).indexOf(w) >= 0; });
    });
    var key = { deadline: function (c) { var a = CA.info(c).act; return a ? a.deadline : '9999'; }, name: function (c) { return c.name.toLowerCase(); }, category: function (c) { return CA.catName(c.category); }, party: function (c) { return c.party.toLowerCase(); }, annual: function (c) { return CA.info(c).annual; }, end: function (c) { return CA.info(c).end || '9999'; } }[f.sort] || function (c) { return c.name; };
    return list.sort(function (a, b) { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * f.dir; });
  };
  function pageContracts() {
    var f = CA.ui.list, list = CA.filtered(), pages = Math.max(1, Math.ceil(list.length / 50)); if (f.page >= pages) f.page = pages - 1;
    var th = function (k, t) { return '<th><button data-act="sortl" data-k="' + k + '">' + t + (f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>'; };
    return '<div class="head"><div><h1>Contracts</h1><p class="sub">' + list.length + ' of ' + all().length + ' contracts</p></div><div class="row"><button class="btn" data-act="importc">Import CSV</button><button class="btn" data-act="exportc">Export CSV</button><button class="btn pri" data-act="newc">New contract</button></div></div>' +
      '<div class="row card" style="margin-bottom:12px"><input type="search" placeholder="Search every field" aria-label="Search" value="' + esc(f.q) + '" data-inp="lq" style="flex:1;min-width:160px"><select aria-label="Category" data-chg="lf" data-k="cat">' + opt('', 'All categories') + X.CATEGORIES.map(function (k) { return opt(k.id, k.name, f.cat === k.id); }).join('') + '</select><select aria-label="Status" data-chg="lf" data-k="status">' + opt('', 'Any status') + Object.keys(X.STATUSES).map(function (k) { return opt(k, X.STATUSES[k], f.status === k); }).join('') + '</select><select aria-label="Decision" data-chg="lf" data-k="decision">' + opt('', 'Any decision') + Object.keys(X.DECISIONS).map(function (k) { return opt(k, X.DECISIONS[k], f.decision === k); }).join('') + '</select><select aria-label="Company" data-chg="lf" data-k="company">' + opt('', 'All companies') + X.COMPANIES.map(function (k) { return opt(k, k, f.company === k); }).join('') + '</select><select aria-label="Deadline" data-chg="lf" data-k="due">' + opt('', 'Any deadline') + opt('30', 'Deadline in 30 days', f.due === '30') + opt('90', 'Deadline in 90 days', f.due === '90') + '</select></div>' +
      '<div class="card scroll"><table class="tbl"><thead><tr>' + th('name', 'Contract') + th('category', 'Category') + th('party', 'Party') + th('deadline', 'Next deadline') + th('end', 'Ends / renews') + th('annual', 'Annual') + '<th>Decision</th></tr></thead><tbody>' +
      list.slice(f.page * 50, f.page * 50 + 50).map(function (c) { var i = CA.info(c); return '<tr><td>' + cLink(c) + '<div class="small mute">' + esc(c.id + ' · ' + c.company) + '</div></td><td>' + esc(CA.catName(c.category)) + '</td><td>' + esc(c.party) + '</td><td>' + (i.act ? '<span class="' + daysCls(i.act.deadline) + '">' + fmtD(i.act.deadline) + '</span><div class="small mute">' + CA.rel(i.act.deadline) + '</div>' : statusPill(c)) + '</td><td>' + (i.nr ? fmtD(i.nr.date) + (i.nr.locked ? ' ' + pill('bad', 'locked') : '') : i.end ? fmtD(i.end) : '<span class="mute">open-ended</span>') + '</td><td>' + (i.annual ? eur(i.annual) : '') + '</td><td>' + decPill(c) + '</td></tr>'; }).join('') + (list.length ? '' : '<tr><td colspan="7" class="mute">No contracts match.</td></tr>') + '</tbody></table></div>' +
      '<div class="row" style="justify-content:center;margin-top:10px"><button class="btn small" data-act="page" data-d="-1"' + (f.page ? '' : ' disabled') + '>Previous</button><span class="small mute">Page ' + (f.page + 1) + ' of ' + pages + '</span><button class="btn small" data-act="page" data-d="1"' + (f.page < pages - 1 ? '' : ' disabled') + '>Next</button></div>';
  }
  ACT.sortl = function (el) { var f = CA.ui.list; if (f.sort === el.dataset.k) f.dir = -f.dir; else { f.sort = el.dataset.k; f.dir = 1; } CA.saveUi(); CA.rerender(); };
  ACT.page = function (el) { CA.ui.list.page += +el.dataset.d; CA.saveUi(); CA.rerender(); window.scrollTo(0, 0); };
  CHG.lf = function (el) { CA.ui.list[el.dataset.k] = el.value; CA.ui.list.page = 0; CA.saveUi(); CA.rerender(); };
  INP.lq = function (el) { CA.ui.list.q = el.value; CA.ui.list.page = 0; CA.saveUi(); CA.rerender(); };

  /* ---------- detail ---------- */
  function fact(k, v) { return '<div><dt>' + k + '</dt><dd>' + (v == null || v === '' ? '<span class="mute">-</span>' : v) + '</dd></div>'; }
  function pageDetail(id) {
    var c = CA.IX[id]; if (!c) return '<h1>Contract not found</h1><p><a href="#/contracts">Back to contracts</a></p>';
    var i = CA.info(c), nd = i.nd, alert = '', y = +TODAY.slice(0, 4);
    if (i.act) alert = '<div class="alert ' + (i.act.locked || CA.daysTo(i.act.deadline) > 30 ? 'info' : 'bad') + '"><b>' + (i.act.kind === 'decide' ? 'Decision needed' : 'Notice deadline') + ' ' + CA.rel(i.act.deadline) + '.</b> ' + esc(CA.deadlineText(c, i.act)) + '</div>';
    else if (nd && nd.locked) alert = '<div class="alert info">' + esc(CA.deadlineText(c, nd)) + '</div>';
    else if (c.status === 'ending' || c.status === 'ended' || c.status === 'draft') alert = '<div class="alert info">' + esc(CA.deadlineText(c, null)) + '</div>';
    var notice = c.noticeN ? c.noticeN + ' ' + (c.noticeUnit === 'days' ? 'days' : 'months') + (c.noticeEom ? ', to month end' : '') : 'none';
    return '<p class="small"><a href="#/contracts">&larr; Contracts</a></p><div class="head"><div><h1>' + esc(c.name) + '</h1><p class="sub">' + esc(c.id + ' · ' + CA.catName(c.category) + ' · ' + c.party) + '</p></div><div class="row">' + statusPill(c) + decPill(c) + '<button class="btn" data-act="editc" data-id="' + c.id + '">Edit</button><button class="btn" data-act="dupc" data-id="' + c.id + '">Duplicate as template</button></div></div>' + alert +
      '<div class="grid g2"><div class="card"><h2>Key facts</h2><dl class="facts">' + fact('Type', X.TYPES[c.type]) + fact('Company', esc(c.company)) + fact('Location', esc(c.location)) + fact('Owner', esc(c.owner)) + fact('Start', fmtD(c.start)) + fact(c.type === 'auto' ? 'First term ends' : 'End', fmtD(c.end)) + (c.type === 'auto' ? fact('Renews for', c.renewMonths + ' months') : '') + fact('Notice period', notice) + fact('Next renewal', i.nr ? fmtD(i.nr.date) + (i.nr.locked ? ' (locked in)' : '') : '') + fact('Ends', c.endsOn ? fmtD(c.endsOn) : i.end ? fmtD(i.end) : '') + fact('Contact', esc(c.contact.name) + ' · ' + esc(c.contact.email) + ' · ' + esc(c.contact.phone)) + fact('IBAN', esc(c.iban)) + '</dl></div>' +
      '<div class="card"><h2>Value</h2><dl class="facts">' + fact('Amount', CA.money(c.amount, c.currency) + ' ' + X.PERIODS[c.period]) + fact('Annual (EUR)', i.annual ? eur(i.annual) : '') + fact('Indexation', c.index.mode === 'cpi' ? 'CPI, ' + (c.index.on === 'jan1' ? 'each 1 January' : 'on the anniversary') : c.index.mode === 'fixed' ? 'Fixed step ' + c.index.step + '% each 1 January' : 'None') + fact('Next price change', i.nextPrice ? fmtD(i.nextPrice.date) + (i.nextPrice.amount ? ' to ' + CA.money(i.nextPrice.amount, c.currency) : ' (indexation)') : '') + fact('Expected ' + y, eur(CA.projectYear(c, y))) + fact('Expected ' + (y + 1), eur(CA.projectYear(c, y + 1))) + '</dl></div></div>' +
      '<div style="margin-top:12px">' + timelineCard(c) + '</div>' +
      '<div class="grid g2" style="margin-top:12px"><div class="card"><h2>Decision</h2><label class="f">Decision<select data-chg="decide" data-id="' + c.id + '">' + Object.keys(X.DECISIONS).map(function (k) { return opt(k, X.DECISIONS[k], c.decision === k); }).join('') + '</select></label><label class="f">Decide by<input type="date" data-chg="decby" data-id="' + c.id + '" value="' + esc(c.decisionBy) + '"></label><div class="row">' + (live(c) && c.status !== 'ending' ? '<button class="btn" data-act="noticegiven" data-id="' + c.id + '">Notice given</button>' : '') + '<a class="btn" href="#/contracts" data-act="delc" data-id="' + c.id + '">Delete</a></div></div>' +
      '<div class="card"><h2>Documents</h2>' + (c.docs.length ? c.docs.map(function (d, k) { return '<div class="row" style="justify-content:space-between;margin:5px 0"><span>' + esc(d.name) + (d.demo ? ' <span class="small mute">(demo, no file)</span>' : '') + '</span><span><button class="btn small" data-act="viewdoc" data-id="' + c.id + '" data-k="' + k + '">View</button> <button class="btn small danger" data-act="deldoc" data-id="' + c.id + '" data-k="' + k + '" aria-label="Remove document">&times;</button></span></div>'; }).join('') : '<p class="mute">No documents.</p>') + '<button class="btn" data-act="attach" data-id="' + c.id + '">Attach PDF or photo</button><p class="small mute">PDF, PNG, JPEG or WebP, up to 20 MB. Stored in this browser only.</p></div></div>' +
      '<div class="grid g2" style="margin-top:12px"><div class="card"><h2>Notes</h2><textarea aria-label="Notes" data-chg="notes" data-id="' + c.id + '" placeholder="Negotiation notes, contacts, reminders">' + esc(c.notes) + '</textarea></div><div class="card"><h2>History</h2>' + (c.history.length ? c.history.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (h) { return '<div class="small" style="margin:5px 0"><span class="mute">' + fmtD(h.date) + '</span> ' + esc(h.text) + '</div>'; }).join('') : '<p class="mute">No history yet.</p>') + '</div></div>';
  }

  /* ---------- calendar ---------- */
  function pageCalendar() {
    var m = CA.ui.cal.m || TODAY.slice(0, 7), y = +m.slice(0, 4), mo = +m.slice(5, 7), first = m + '-01', start = D.addDays(first, -((D.dn(first) + 3) % 7)), end = D.addDays(start, 41);
    var pm = mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'), nm = mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'), T = CA.ui.cal.types;
    var ev = {}, list = []; all().forEach(function (c) { if (c.status === 'ended') return; D.events(c, start, end, TODAY).forEach(function (e) { if (T[e.type] === false) return; e.c = c; (ev[e.date] = ev[e.date] || []).push(e); if (e.date.slice(0, 7) === m) list.push(e); }); });
    var cells = ''; for (var i = 0; i < 42; i++) { var d = D.addDays(start, i), out = d.slice(0, 7) !== m; if (i >= 35 && out) break; var es = ev[d] || []; cells += '<div class="day' + (out ? ' out' : '') + (d === TODAY ? ' today' : '') + '"><b>' + +d.slice(8) + '</b>' + es.slice(0, 3).map(function (e) { return '<a class="chip" style="--ev:var(--ev-' + e.type + ')" href="#/contracts/' + e.c.id + '" title="' + esc(e.text + ': ' + e.c.name) + '">' + esc(e.c.name) + '</a>'; }).join('') + (es.length > 3 ? '<span class="small mute">+' + (es.length - 3) + '</span>' : '') + '</div>'; }
    list.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return '<div class="head"><div><h1>Calendar</h1><p class="sub">Deadlines, renewals, price changes and milestones.</p></div><div class="row"><a class="btn" href="#/calendar" data-act="cal" data-m="' + pm + '">&larr;</a><b>' + m + '</b><a class="btn" href="#/calendar" data-act="cal" data-m="' + nm + '">&rarr;</a><a class="btn" href="#/calendar" data-act="cal" data-m="' + TODAY.slice(0, 7) + '">Today</a><button class="btn" data-act="ics">Download .ics</button></div></div>' +
      '<div class="row" style="margin-bottom:10px">' + Object.keys(D.LABELS).map(function (t) { return '<label class="chipf"><input type="checkbox" data-chg="evt" data-k="' + t + '"' + (T[t] === false ? '' : ' checked') + '><span class="dot" style="background:var(--ev-' + t + ')"></span>' + esc(D.LABELS[t]) + '</label>'; }).join('') + '</div>' +
      '<div class="cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<div class="dh">' + d + '</div>'; }).join('') + cells + '</div>' +
      '<div class="card" style="margin-top:12px"><h2>Agenda for ' + m + '</h2>' + (list.length ? list.map(function (e) { return '<div class="ev"><span class="dot" style="background:var(--ev-' + e.type + ')"></span><span class="small mute" style="width:78px">' + fmtD(e.date) + '</span> ' + cLink(e.c) + ' <span class="small mute">' + esc(e.text) + '</span></div>'; }).join('') : '<p class="mute">Nothing this month.</p>') + '</div>';
  }
  ACT.cal = function (el) { CA.ui.cal.m = el.dataset.m; CA.saveUi(); CA.rerender(); };
  CHG.evt = function (el) { CA.ui.cal.types[el.dataset.k] = el.checked; CA.saveUi(); CA.rerender(); };

  /* ---------- reminders ---------- */
  function pageReminders() {
    var rs = CA.reminders(), H = CA.db.settings.handled, due = rs.filter(function (r) { return !H[r.key]; }), done = rs.filter(function (r) { return H[r.key]; });
    var perm = window.Notification ? Notification.permission : 'unsupported';
    var row = function (r, handled) { return '<div class="row" style="justify-content:space-between;margin:7px 0"><span><b class="' + daysCls(r.date) + '">' + fmtD(r.date) + '</b> <span class="small mute">' + CA.rel(r.date) + '</span><br>' + cLink(r.c) + ' <span class="small mute">' + esc(r.text.split(':')[0]) + '</span></span><button class="btn small" data-act="' + (handled ? 'unhandle' : 'handle') + '" data-key="' + esc(r.key) + '">' + (handled ? 'Undo' : 'Mark handled') + '</button></div>'; };
    return '<div class="head"><div><h1>Reminders</h1><p class="sub">In-app only: nothing is e-mailed or posted anywhere.</p></div></div>' +
      '<div class="grid g2"><div class="card"><h2>Due (' + due.length + ')</h2>' + (due.length ? due.map(function (r) { return row(r, false); }).join('') : '<p class="mute">Nothing due.</p>') + '</div><div class="card"><h2>Handled (' + done.length + ')</h2>' + (done.length ? done.map(function (r) { return row(r, true); }).join('') : '<p class="mute">Nothing handled yet.</p>') + '</div></div>' +
      '<div class="card" style="margin-top:12px"><h2>Browser notifications</h2><p class="small mute">Shown only while this page is open. Status: ' + esc(perm) + '.</p><label class="row"><input type="checkbox" data-chg="notify"' + (CA.ui.notify ? ' checked' : '') + (perm === 'unsupported' ? ' disabled' : '') + '> Notify me about due reminders</label></div>' +
      '<div class="card" style="margin-top:12px"><h2>Reminder windows</h2><p class="small mute">How many days before a notice deadline a reminder appears.</p><div class="grid g4">' + X.CATEGORIES.map(function (k) { return '<label class="f">' + esc(k.name) + '<input type="number" min="0" max="365" data-chg="remwin" data-k="' + k.id + '" value="' + (CA.db.settings.remind[k.id]) + '"></label>'; }).join('') + '</div></div>';
  }
  ACT.handle = function (el) { CA.db.settings.handled[el.dataset.key] = Date.now(); CA.commit(); };
  ACT.unhandle = function (el) { delete CA.db.settings.handled[el.dataset.key]; CA.commit(); };
  CHG.remwin = function (el) { CA.db.settings.remind[el.dataset.k] = Math.max(0, Math.min(365, parseInt(el.value, 10) || 0)); CA.commit(); };

  /* ---------- spend ---------- */
  function pageSpend() {
    var by = CA.ui.spend.by, y = +TODAY.slice(0, 4), g = {}, key = { category: function (c) { return CA.catName(c.category); }, party: function (c) { return c.party; }, location: function (c) { return c.location; }, company: function (c) { return c.company; } }[by];
    all().forEach(function (c) { var k = key(c), r = g[k] = g[k] || { t: k, a: 0, b: 0 }; r.a += CA.info(c).annual; r.b += CA.projectYear(c, y + 1); });
    var rows = Object.keys(g).map(function (k) { return g[k]; }).filter(function (r) { return r.a || r.b; }).sort(function (a, b) { return b.a - a.a; }), ta = 0, tb = 0; rows.forEach(function (r) { ta += r.a; tb += r.b; });
    return '<div class="head"><div><h1>Spend</h1><p class="sub">Current yearly spend against the projection for ' + (y + 1) + ' (indexation at ' + CA.db.settings.cpi + '% CPI, scheduled price changes, expected ends).</p></div><div class="row"><label class="row small">Group by <select data-chg="spendby">' + ['category', 'party', 'location', 'company'].map(function (k) { return opt(k, k, by === k); }).join('') + '</select></label><label class="row small">CPI % <input type="number" step="0.1" style="width:70px" data-chg="cpi" value="' + CA.db.settings.cpi + '"></label><button class="btn" data-act="csvspend">Export CSV</button></div></div>' +
      '<div class="card"><div class="small row"><span style="color:var(--accent)">&#9632; Now (per year)</span><span style="color:var(--warn)">&#9632; Expected ' + (y + 1) + '</span></div>' + hbars(rows.slice(0, 12).map(function (r) { return { t: r.t, a: r.a, b: r.b }; }), 'Spend now and next year by ' + by) + '</div>' +
      '<div class="card scroll" style="margin-top:12px"><table class="tbl"><tr><th>' + by + '</th><th>Now / year</th><th>Expected ' + (y + 1) + '</th><th>Change</th></tr>' + rows.map(function (r) { return '<tr><td>' + esc(r.t) + '</td><td>' + eur(r.a) + '</td><td>' + eur(r.b) + '</td><td>' + (r.a ? (r.b / r.a * 100 - 100).toFixed(1) + '%' : '') + '</td></tr>'; }).join('') + '<tr><th>Total</th><th>' + eur(ta) + '</th><th>' + eur(tb) + '</th><th>' + (ta ? (tb / ta * 100 - 100).toFixed(1) + '%' : '') + '</th></tr></table></div><p class="small mute">Fixed-term contracts are assumed to be extended at the same price unless the decision is to cancel.</p>';
  }
  CHG.spendby = function (el) { CA.ui.spend.by = el.value; CA.saveUi(); CA.rerender(); };
  CHG.cpi = function (el) { CA.db.settings.cpi = Math.max(0, Math.min(30, parseFloat(el.value) || 0)); CA.commit(); };
  ACT.csvspend = function () { var by = CA.ui.spend.by, y = +TODAY.slice(0, 4), g = {}; all().forEach(function (c) { var k = by === 'category' ? CA.catName(c.category) : c[by], r = g[k] = g[k] || [k, 0, 0]; r[1] += CA.info(c).annual; r[2] += CA.projectYear(c, y + 1); }); CA.csv([[by, 'Now per year EUR', 'Expected ' + (y + 1) + ' EUR']].concat(Object.keys(g).map(function (k) { return [g[k][0], Math.round(g[k][1]), Math.round(g[k][2])]; })), 'spend.csv'); };

  CA.PAGES = { '': pageOverview, contracts: function (p) { return p[1] ? pageDetail(p[1]) : pageContracts(); }, calendar: pageCalendar, reminders: pageReminders, spend: pageSpend };
})();
