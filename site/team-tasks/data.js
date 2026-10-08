/* Team Tasks demo workspace. Fictional people and work items; every date is relative to the moment the
 * demo is created, so the board always looks current. window.TeamTasksSeed(now) → a fresh database. */
(function () {
  'use strict';

  var MEMBERS = [
    ['m1', 'Ana Kovač', '#5B3FE0'],
    ['m2', 'Luka Novak', '#3E5BA9'],
    ['m3', 'Maja Horvat', '#17869C'],
    ['m4', 'Tim Zupan', '#B4561C'],
    ['m5', 'Eva Kranjc', '#3F7D58'],
    ['m6', 'Jan Vidmar', '#8A3F7A']
  ];
  var LABELS = [
    ['l1', 'Bug', '#C2410C'],
    ['l2', 'Feature', '#5B3FE0'],
    ['l3', 'Improvement', '#3E5BA9'],
    ['l4', 'Design', '#B4561C'],
    ['l5', 'Data', '#17869C'],
    ['l6', 'Operations', '#3F7D58'],
    ['l7', 'Store', '#8A3F7A']
  ];
  // id, name, team, lead, status, target (days from now), colour, description
  var PROJECTS = [
    ['p1', 'Web shop relaunch', 't1', 'm2', 'started', 38, '#5B3FE0', 'New product pages, faster category pages and a cleaner checkout for SI and HR.'],
    ['p2', 'Q4 campaign', 't1', 'm3', 'started', 24, '#B4561C', 'Black Friday and Christmas: landing pages, newsletters, feeds and promo rules.'],
    ['p3', 'Warehouse scanners', 't2', 'm4', 'started', 52, '#17869C', 'Hand scanners and an offline pick-list for the Ljubljana warehouse.'],
    ['p4', 'Zagreb store opening', 't2', 'm5', 'planned', 80, '#3F7D58', 'Fit-out, staff, POS and fiscal registration for the first Zagreb store.'],
    ['p5', 'Contact lens subscriptions', 't1', 'm1', 'planned', 110, '#3E5BA9', 'Repeat deliveries every 30, 60 or 90 days with reminder e-mails.'],
    ['p6', 'Returns portal', 't1', 'm6', 'completed', -20, '#8F8C85', 'Self-service returns with printable labels and refund tracking.']
  ];
  // team, title, status, priority, assignee, labels, project, cycle offset, due (days), estimate, created (days ago), creator, done/canceled (days ago), parent (index), description
  var ISSUES = [
    ['t1', 'Checkout shows the wrong VAT for Croatian delivery addresses', 'progress', 1, 'm2', ['l1'], 'p1', 0, 1, 3, 6, 'm1', null, null, 'Orders from SI customers shipping to HR are charged 22 % instead of 25 %.\n\nSteps: add a Croatian delivery address while the billing address stays in Slovenia, then open the order summary.'],
    ['t1', 'Lens configurator loses the selection after going back a step', 'todo', 2, 'm2', ['l1'], 'p1', 0, 4, 2, 5, 'm1'],
    ['t1', 'Product gallery with zoom and 360° frame views', 'progress', 2, 'm6', ['l2', 'l4'], 'p1', 0, 6, 5, 12, 'm1', null, null, 'Use the photo studio exports (8 angles per frame). Keep the first image loading eagerly.'],
    ['t1', 'Move product reviews to the new template', 'todo', 3, 'm6', ['l3'], 'p1', 0, null, 3, 9, 'm2'],
    ['t1', 'Frame size guide', 'review', 3, 'm3', ['l4'], 'p1', 0, null, 2, 10, 'm1'],
    ['t1', 'Cart drawer: free-shipping progress bar', 'done', 3, 'm6', ['l2'], 'p1', 0, null, 2, 20, 'm1', 6],
    ['t1', 'Search: typo tolerance for brand names', 'backlog', 4, null, ['l3'], 'p1', null, null, 3, 15, 'm2', null, null, 'Ray-Ban, Oakley and Persol are misspelled in about 6 % of searches.'],
    ['t1', 'Category pages score below 60 in Lighthouse on mobile', 'todo', 2, 'm2', ['l1', 'l3'], 'p1', 0, null, 5, 4, 'm1'],
    ['t1', 'Black Friday landing page', 'progress', 2, 'm3', ['l4'], 'p2', 0, 10, 3, 8, 'm1'],
    ['t1', 'Newsletter templates for Q4 (four sends)', 'todo', 3, 'm3', ['l4'], 'p2', 1, 14, 3, 3, 'm1'],
    ['t1', 'Promo code stacking rules for Black Friday', 'todo', 1, 'm2', ['l2'], 'p2', 0, 5, 3, 2, 'm1'],
    ['t1', 'Google Shopping feed: 312 products without a GTIN', 'review', 2, 'm1', ['l1', 'l5'], 'p2', 0, 2, 2, 7, 'm3'],
    ['t1', 'Meta catalogue sync fails for variants with special characters', 'backlog', 3, null, ['l1', 'l5'], 'p2', null, null, null, 11, 'm1'],
    ['t1', 'Banner set: 1080×1080, 1080×1920 and 1200×628', 'done', 3, 'm3', ['l4'], 'p2', -1, null, 2, 18, 'm1', 12],
    ['t1', 'Subscriptions: delivery every 30, 60 or 90 days', 'backlog', 3, 'm1', ['l2'], 'p5', null, null, 5, 21, 'm1'],
    ['t1', 'Reorder reminder e-mail for contact lens customers', 'backlog', 2, 'm1', ['l2'], 'p5', 1, null, 3, 13, 'm5'],
    ['t1', 'Returns portal: printable return label', 'done', 3, 'm6', ['l2'], 'p6', -2, null, 3, 40, 'm1', 26],
    ['t1', 'Returns portal: refund status page', 'done', 4, 'm2', ['l2'], 'p6', -2, null, 2, 38, 'm1', 24],
    ['t1', 'Footer links to the old blog return 404', 'canceled', 4, 'm6', ['l1'], null, -1, null, null, 16, 'm2', 12],
    ['t1', 'Add Klarna to the payment options in HR', 'backlog', 3, null, ['l2'], null, null, null, null, 30, 'm1'],
    ['t1', 'Track add-to-cart for lens packages in GA4', 'progress', 3, 'm1', ['l5'], 'p1', 0, null, 2, 5, 'm1'],
    ['t1', 'Category filters: frame shape and material', 'todo', 3, 'm6', ['l2'], 'p1', 1, null, 3, 6, 'm1'],
    ['t1', 'Accessibility pass on checkout (labels, focus order)', 'todo', 4, 'm3', ['l3'], 'p1', 1, null, 2, 4, 'm1'],
    ['t1', 'Unit tests for the HR VAT rules', 'todo', 2, 'm2', ['l1'], 'p1', 0, null, 1, 3, 'm2', null, 0],
    ['t1', 'Recalculate VAT when the delivery address changes', 'done', 2, 'm2', ['l1'], 'p1', 0, null, 2, 5, 'm2', 1, 0],
    ['t2', 'Barcode scanners for the Ljubljana warehouse (12 units)', 'progress', 2, 'm4', ['l6'], 'p3', 0, 3, 3, 10, 'm5'],
    ['t2', 'Pick-list app: offline mode', 'todo', 3, 'm4', ['l2'], 'p3', 0, null, 5, 7, 'm5'],
    ['t2', 'Label printer jams on GLS labels', 'review', 1, 'm5', ['l1', 'l6'], 'p3', 0, -1, 1, 4, 'm4'],
    ['t2', 'Train the warehouse team on the scanner workflow', 'backlog', 3, 'm5', ['l6'], 'p3', 1, 18, null, 6, 'm4'],
    ['t2', 'Zagreb store: fit-out plan', 'progress', 2, 'm5', ['l7'], 'p4', 0, 12, 5, 14, 'm1'],
    ['t2', 'Zagreb store: hire two opticians', 'todo', 2, 'm5', ['l7'], 'p4', 1, 40, null, 9, 'm1'],
    ['t2', 'Zagreb store: POS and fiscal registration', 'backlog', 3, 'm4', ['l7'], 'p4', null, 60, null, 9, 'm5'],
    ['t2', 'Stock count differences in the Maribor store', 'todo', 2, 'm4', ['l6', 'l5'], null, 0, 2, 2, 3, 'm1'],
    ['t2', 'Monthly contact lens transfer to the stores', 'done', 3, 'm4', ['l6'], null, -1, null, 1, 17, 'm5', 12],
    ['t2', 'Supplier price lists for Q4', 'progress', 3, 'm5', ['l5'], null, 0, 7, 2, 6, 'm4'],
    ['t2', 'Returns older than 14 days', 'todo', 1, 'm5', ['l6'], null, 0, 0, 3, 2, 'm1'],
    ['t2', 'Courier contract renewal: GLS and DPD comparison', 'backlog', 4, 'm4', ['l6'], null, null, 45, null, 19, 'm5'],
    ['t2', 'Replace the lensmeter in the Koper store', 'done', 2, 'm5', ['l7'], null, 0, null, 1, 15, 'm4', 3],
    ['t2', 'Inventory dashboard: days of cover', 'canceled', 4, 'm4', ['l5'], null, -1, null, null, 24, 'm1', 13],
    ['t2', 'Packaging: switch to recycled boxes', 'backlog', 0, null, ['l6'], null, null, null, null, 27, 'm4']
  ];
  // issue index, actor, days ago, text
  var COMMENTS = [
    [0, 'm2', 1.1, 'Found it: the rate comes from the billing country, but we ship to the delivery country. Fix is in progress.'],
    [0, 'm6', 0.4, 'Same root cause for Slovenian customers with an Austrian delivery address, so let\'s cover both.'],
    [11, 'm5', 0.9, 'Down to 41 after today\'s supplier file. The rest are house-brand frames without a GTIN, so they need identifier_exists = false.'],
    [8, 'm3', 2.2, 'First draft is ready. Looking for feedback on the hero before Friday.'],
    [8, 'm1', 1.6, 'Looks great. Lead with lenses, frames second.'],
    [20, 'm2', 0.25, 'The event fires twice on the configurator page; I\'ll debounce it.'],
    [15, 'm5', 3.8, 'Customer support gets about 20 calls a week asking for this. Happy to help with the copy.'],
    [27, 'm4', 1.0, 'Replaced the roll holder, still jamming every ~40 labels. A new feed roller is on order.'],
    [35, 'm5', 0.2, 'Down from 64 to 38 since Monday.'],
    [29, 'm4', 2.0, 'Electrician is booked for the 20th.'],
    [4, 'm3', 0.7, 'Ready for review: the guide now shows lens width, bridge and temple length with a printable ruler.']
  ];

  function seed(now) {
    now = now || new Date();
    var DAY = 864e5, t0 = now.getTime(), seq = 0;
    function id(p) { seq += 1; return p + seq.toString(36) + Math.random().toString(36).slice(2, 7); }
    function ago(days, k) { return new Date(t0 - days * DAY - ((k || 0) % 7 + 1) * 1800e3).toISOString(); }
    function ymd(off) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // Two-week cycles; cycle 14 started on the Monday of last week.
    var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    var start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 - 13 * 14);
    var cycleStart = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');

    var db = {
      schema: 1,
      workspace: { name: 'Adrial' },
      me: 'm1',
      members: MEMBERS.map(function (m) { return { id: m[0], name: m[1], color: m[2] }; }),
      teams: [
        { id: 't1', key: 'WEB', name: 'Web shop', color: '#5B3FE0', next: 112, cycleStart: cycleStart, cycleDays: 14 },
        { id: 't2', key: 'OPS', name: 'Operations', color: '#B4561C', next: 47, cycleStart: cycleStart, cycleDays: 14 }
      ],
      labels: LABELS.map(function (l) { return { id: l[0], name: l[1], color: l[2] }; }),
      projects: PROJECTS.map(function (p) {
        return { id: p[0], name: p[1], team: p[2], lead: p[3], status: p[4], target: ymd(p[5]), color: p[6], description: p[7], createdAt: ago(60) };
      }),
      issues: [],
      display: {},
      inbox: {},
      createdAt: now.toISOString()
    };
    var teamOf = { t1: db.teams[0], t2: db.teams[1] };
    ISSUES.forEach(function (r, k) {
      var team = teamOf[r[0]], created = ago(r[10], k), status = r[2];
      var it = {
        id: id('i'), team: r[0], number: team.next++, title: r[1], description: r[14] || '', status: status, priority: r[3],
        assignee: r[4], creator: r[11], labels: r[5].slice(), project: r[6], cycle: r[7] == null ? null : 14 + r[7],
        due: r[8] == null ? null : ymd(r[8]), estimate: r[9], parent: null, subscribers: [], sort: k,
        createdAt: created, updatedAt: created, completedAt: null, canceledAt: null, activity: []
      };
      it.activity.push({ id: id('a'), type: 'create', actor: it.creator, at: created });
      var age = r[10];
      if (status === 'done' || status === 'canceled') {
        var at = ago(r[12], k + 3);
        if (status === 'done') it.completedAt = at; else it.canceledAt = at;
        it.activity.push({ id: id('a'), type: 'change', field: 'status', from: 'todo', to: 'progress', actor: it.assignee || it.creator, at: ago(Math.max(r[12] + 1, age * 0.6), k + 1) });
        it.activity.push({ id: id('a'), type: 'change', field: 'status', from: 'progress', to: status, actor: it.assignee || it.creator, at: at });
        it.updatedAt = at;
      } else if (status === 'progress' || status === 'review') {
        var s1 = ago(age * 0.6, k + 1);
        it.activity.push({ id: id('a'), type: 'change', field: 'status', from: 'todo', to: 'progress', actor: it.assignee || it.creator, at: s1 });
        it.updatedAt = s1;
        if (status === 'review') {
          var s2 = ago(Math.min(age * 0.2, 0.8), k + 2);
          it.activity.push({ id: id('a'), type: 'change', field: 'status', from: 'progress', to: 'review', actor: it.assignee || it.creator, at: s2 });
          it.updatedAt = s2;
        }
      }
      [it.creator, it.assignee].forEach(function (m) { if (m && it.subscribers.indexOf(m) < 0) it.subscribers.push(m); });
      db.issues.push(it);
    });
    ISSUES.forEach(function (r, k) { if (r[13] != null) db.issues[k].parent = db.issues[r[13]].id; });
    COMMENTS.forEach(function (c, k) {
      var it = db.issues[c[0]], at = ago(c[2], k);
      it.activity.push({ id: id('a'), type: 'comment', actor: c[1], at: at, text: c[3] });
      if (it.subscribers.indexOf(c[1]) < 0) it.subscribers.push(c[1]);
      if (at > it.updatedAt) it.updatedAt = at;
    });
    db.issues.forEach(function (it) { it.activity.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }); });
    // Ana has already read everything older than two days, so the inbox opens with a realistic few unread.
    var read = {};
    db.issues.forEach(function (it) { read[it.id] = ago(2); });
    db.inbox.m1 = { read: read, cleared: {} };
    return db;
  }

  window.TeamTasksSeed = seed;
})();
