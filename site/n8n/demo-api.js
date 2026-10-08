/* Demo data for the "n8n Runs" page. Everything here is made up: fictional workflows, no real systems or people.
 * Answers GET /api/n8n/{workflows | daily?days=N | runs?days=N[&workflow=ID] | meta} in the browser.
 * All figures are derived from one generated model (schedule slots + runs), so the KPI cards, the per-day chart,
 * the workflow table and the run lists always agree with each other. Dates are relative to today (Europe/Ljubljana). */
(function () {
  'use strict';
  var D = window.AdrialDemo;
  if (!D) return;

  var TZ = 'Europe/Ljubljana', DAY = 86400000, WINDOW = 45;
  var fmtParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

  function ljParts(ms) { var o = {}; fmtParts.formatToParts(new Date(Math.floor(ms / 1000) * 1000)).forEach(function (p) { o[p.type] = +p.value; }); return o; }
  function ljOffsetMin(ms) { var p = ljParts(ms); return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ljDate(ms) { var p = ljParts(ms); return p.year + '-' + pad(p.month) + '-' + pad(p.day); }
  /** local (Europe/Ljubljana) day string + minute-of-day -> UTC ms */
  function localToUtc(ds, min) { var t = D.parseDay(ds).getTime(); return t + (min - ljOffsetMin(t + 12 * 3600000)) * 60000; }
  function iso(ms) { return new Date(ms).toISOString(); }
  function ev(step, from, to) { var a = []; for (var m = from; m <= to; m += step) a.push(m); return a; }
  function mkId(name) { var r = D.rng('id|' + name), a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = ''; for (var i = 0; i < 16; i++) s += a.charAt(r.int(0, 61)); return s; }
  function r1(x) { return Math.round(x * 10) / 10; }

  var WD = [1, 2, 3, 4, 5];
  var WDNAME = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

  function definitions(todayD) {
    var newDow = (todayD.getUTCDay() + 3) % 7;
    return [
      { name: 'Supplier invoices to accounting', active: true, kind: 'schedule', times: ev(60, 420, 1140), dow: WD, expr: '0 7-19 * * 1-5', desc: 'Hourly 07:00–19:00, Mon–Fri', nodes: 14, dur: 40, fail: 0.02, miss: 0.002, dep: [3, 9, 40], err: ['Parse PDF', 'Accounting API'] },
      { name: 'Nightly stock sync', active: true, kind: 'schedule', times: [120], expr: '0 2 * * *', desc: 'Every day at 02:00', nodes: 19, dur: 410, fail: 0.05, miss: 0.01, dep: [12, 16, 25], err: ['Warehouse API', 'Postgres: upsert stock'], manualP: 0.06 },
      { name: 'Abandoned cart e-mail', active: true, kind: 'schedule', times: ev(30, 480, 1290), expr: '*/30 8-21 * * *', desc: 'Every 30 min, 08:00–21:30', nodes: 11, dur: 9, fail: 0.01, miss: 0.002, dep: [1, 11, 15], err: ['Send E-mail', 'Shop API'] },
      { name: 'Parcel status poll', active: true, kind: 'schedule', times: ev(60, 0, 1380), expr: '0 * * * *', desc: 'Every hour', nodes: 9, dur: 20, fail: 0.02, miss: 0.002, dep: [27, 8, 5], err: ['HTTP Request: Carrier tracking'] },
      { name: 'GA4 to BigQuery export', active: true, kind: 'schedule', times: [330], expr: '30 5 * * *', desc: 'Every day at 05:30', nodes: 16, dur: 190, fail: 0.06, miss: 0.01, dep: [6, 13, 50], err: ['Google Analytics 4', 'BigQuery: insert rows'], manualP: 0.05 },
      { name: 'Product feed export to marketplaces', active: true, kind: 'schedule', times: ev(60, 370, 1330), expr: '10 6-22 * * *', desc: 'Hourly at :10, 06:10–22:10', nodes: 23, dur: 800, fail: 0.02, miss: 0.003, dep: [0, 8, 30], err: ['Build XML feed', 'SFTP upload'] },
      { name: 'Order confirmation e-mails', active: true, kind: 'webhook', perDay: 32, fail: 0.01, nodes: 8, dur: 4, dep: [40, 10, 0], err: ['Send E-mail'] },
      { name: 'Payment gateway reconciliation', active: true, kind: 'schedule', times: [375], expr: '15 6 * * *', desc: 'Every day at 06:15', nodes: 17, dur: 95, fail: 0.03, miss: 0.005, state: 'failing', bad: 2, dep: [9, 15, 20], err: ['Match payments'] },
      { name: 'Price list import (supplier CSV)', active: true, kind: 'schedule', times: [450, 750, 990], dow: WD, expr: '30 7,12,16 * * 1-5', desc: 'Weekdays at 07:30, 12:30, 16:30', nodes: 12, dur: 75, fail: 0.03, miss: 0.01, state: 'missing', bad: 1, dep: [2, 14, 5], err: ['Read CSV', 'Postgres: upsert prices'] },
      { name: 'Newsletter subscriber sync', active: true, kind: 'schedule', times: ev(120, 0, 1320), expr: '0 */2 * * *', desc: 'Every 2 hours', nodes: 10, dur: 31, fail: 0.015, miss: 0.002, dep: [15, 9, 45], err: ['Mailing API'] },
      { name: 'Return requests triage', active: true, kind: 'schedule', times: ev(30, 540, 1020), dow: WD, expr: '*/30 9-17 * * 1-5', desc: 'Every 30 min, 09:00–17:00, Mon–Fri', nodes: 13, dur: 14, fail: 0.015, miss: 0.002, dep: [8, 12, 10], err: ['Helpdesk API'] },
      { name: 'Daily sales digest to chat', active: true, kind: 'schedule', times: [480], expr: '0 8 * * *', desc: 'Every day at 08:00', nodes: 7, dur: 12, fail: 0.01, miss: 0.003, dep: [33, 10, 5], err: ['Chat message'] },
      { name: 'Customer review requests', active: true, kind: 'schedule', times: [600], expr: '0 10 * * *', desc: 'Every day at 10:00', nodes: 12, dur: 55, fail: 0.02, miss: 0.004, dep: [4, 15, 30], err: ['Send E-mail', 'Shop API'] },
      { name: 'Low stock alerts', active: true, kind: 'schedule', times: ev(240, 0, 1200), expr: '0 */4 * * *', desc: 'Every 4 hours', nodes: 9, dur: 18, fail: 0.01, miss: 0.002, dep: [18, 7, 50], err: ['Postgres: read stock'] },
      { name: 'Weekly KPI report', active: true, kind: 'schedule', times: [420], dow: [1], expr: '0 7 * * 1', desc: 'Mondays at 07:00', nodes: 21, dur: 150, fail: 0.05, miss: 0.0, dep: [10, 17, 15], err: ['BigQuery: query', 'Build report'] },
      { name: 'Invoice PDF archive to storage', active: true, kind: 'schedule', times: [1410], expr: '30 23 * * *', desc: 'Every day at 23:30', nodes: 10, dur: 240, fail: 0.02, miss: 0.004, dep: [20, 21, 0], err: ['Upload file'] },
      { name: 'CRM contact deduplication', active: true, kind: 'schedule', times: [180], dow: [0], expr: '0 3 * * 0', desc: 'Sundays at 03:00', nodes: 15, dur: 620, fail: 0.05, miss: 0.0, dep: [45, 12, 10], err: ['CRM API'] },
      { name: 'Marketplace order import', active: true, kind: 'schedule', times: ev(30, 420, 1320), expr: '*/30 7-22 * * *', desc: 'Every 30 min, 07:00–22:30', nodes: 18, dur: 28, fail: 0.02, miss: 0.003, state: 'failing', bad: 4, dep: [6, 9, 45], err: ['HTTP Request: Marketplace API'] },
      { name: 'Currency rates update', active: true, kind: 'schedule', times: [360], dow: WD, expr: '0 6 * * 1-5', desc: 'Weekdays at 06:00', nodes: 5, dur: 5, fail: 0.01, miss: 0.003, dep: [60, 8, 0], err: ['HTTP Request: Rates API'] },
      { name: 'Website uptime check', active: true, kind: 'schedule', times: ev(60, 360, 1320), expr: '0 6-22 * * *', desc: 'Hourly 06:00–22:00', nodes: 6, dur: 3, fail: 0.01, miss: 0.002, dep: [80, 11, 30], err: ['HTTP Request: Storefront'] },
      { name: 'Shipping label generator', active: true, kind: 'webhook', perDay: 24, fail: 0.015, nodes: 14, dur: 7, dep: [14, 13, 25], err: ['HTTP Request: Carrier labels', 'Create PDF'] },
      { name: 'Error alert to chat (sub-workflow)', active: true, kind: 'subworkflow', perDay: 0, fail: 0, nodes: 4, dur: 2, dep: [50, 9, 15], err: [] },
      { name: 'Supplier price changes watch', active: false, kind: 'schedule', times: [240], expr: '0 4 * * *', desc: 'Every day at 04:00', nodes: 11, dur: 60, fail: 0.04, miss: 0.0, endAgo: 18, dep: [35, 12, 0], err: ['Read CSV'] },
      { name: 'Legacy CSV exporter (old)', active: false, kind: 'schedule', times: [1080], dow: [5], expr: '0 18 * * 5', desc: 'Fridays at 18:00', nodes: 6, dur: 35, fail: 0.05, miss: 0.0, endAgo: 40, dep: [120, 15, 0], err: ['Write CSV'] },
      { name: 'Birthday discount coupons', active: true, kind: 'schedule', times: [465], expr: '45 7 * * *', desc: 'Every day at 07:45', nodes: 10, dur: 22, fail: 0.02, miss: 0.004, state: 'missing', bad: 2, dep: [7, 14, 30], err: ['Create coupon', 'Send E-mail'] },
      { name: 'Weekly stock ageing report', active: true, kind: 'schedule', times: [450], dow: [newDow], expr: '30 7 * * ' + newDow, desc: WDNAME[newDow] + ' at 07:30', nodes: 13, dur: 80, fail: 0.0, miss: 0.0, fresh: true, dep: [1, 16, 5], err: ['Postgres: stock ageing'] },
      { name: 'Backfill order totals (manual)', active: true, kind: 'manual', manualP: 0.12, fail: 0.1, nodes: 8, dur: 140, dep: [22, 11, 0], err: ['Postgres: update orders'] },
      { name: 'Google Ads cost import', active: true, kind: 'schedule', times: [255], expr: '15 4 * * *', desc: 'Every day at 04:15', nodes: 13, dur: 65, fail: 0.04, miss: 0.006, dep: [2, 10, 20], err: ['Google Ads API'] }
    ];
  }

  var cache = { t: 0, v: null };

  function model() {
    var now = Date.now();
    if (cache.v && now - cache.t < 30000) return cache.v;

    var today = ljDate(now), todayD = D.parseDay(today);
    function dayStr(k) { return D.iso(D.addDays(todayD, -k)); }
    var outS = localToUtc(dayStr(6), 110), outE = localToUtc(dayStr(6), 160); // a short n8n outage: 01:50-02:40, six days ago

    var defs = definitions(todayD), built = [];

    defs.forEach(function (def) {
      var id = mkId(def.name), items = [];
      var updated = localToUtc(dayStr(def.dep[0]), def.dep[1] * 60 + def.dep[2]);
      if (updated > now) updated = now - 40 * 60000;

      function rec(o) {
        o.workflow_id = id; o.workflow_name = def.name;
        o.error_node = o.error_node || null; o.duration_s = o.duration_s == null ? null : o.duration_s;
        o.started_at = o.started_at || null; o.expected_at = o.expected_at || null; o.mode = o.mode || null;
        items.push(o); return o;
      }
      function failNode(r) { return def.err && def.err.length ? r.pick(def.err) : null; }

      // ── scheduled slots ────────────────────────────────────────────────
      if (def.times) {
        var slots = [];
        for (var k = WINDOW; k >= 0; k--) {
          if (k < (def.endAgo || 0)) continue;
          var ds = dayStr(k), wd = D.parseDay(ds).getUTCDay();
          if (def.dow && def.dow.indexOf(wd) < 0) continue;
          for (var q = 0; q < def.times.length; q++) {
            var T = localToUtc(ds, def.times[q]);
            if (T > now || (def.fresh && T < updated)) continue;
            slots.push({ T: T, ds: ds });
          }
        }
        var L = slots.length - 1, bad = def.bad || 1;
        slots.forEach(function (s) {
          s.r = D.rng(id + '|' + s.T);
          var u = s.r();
          s.st = (s.T >= outS && s.T <= outE) ? 'missed' : u < def.miss ? 'missed' : u < def.miss + def.fail ? (s.r() < 0.2 ? 'crashed' : 'error') : 'success';
        });
        if (L >= 0) {
          if (def.state === 'failing') { for (var a = 0; a < bad; a++) if (slots[L - a]) slots[L - a].st = 'error'; if (slots[L - bad]) slots[L - bad].st = 'success'; }
          else if (def.state === 'missing') { for (var b = 0; b < bad; b++) if (slots[L - b]) slots[L - b].st = 'missed'; if (slots[L - bad]) slots[L - bad].st = 'success'; }
          else slots[L].st = 'success';
        }
        slots.forEach(function (s, i) {
          var st = s.st, r = s.r, start = s.T + 4000 + Math.floor(r() * 36000);
          var base = { expected_at: iso(s.T), _day: s.ds, _slot: true };
          if (st === 'missed') {
            if (i === L && now - s.T < 45 * 60000) { base.kind = 'slot'; base.status = 'due'; base._t = s.T; rec(base); }
            else { base.kind = 'slot'; base.status = 'missed'; base._t = s.T; rec(base); }
            return;
          }
          if (start > now) { base.kind = 'slot'; base.status = 'due'; base._t = s.T; rec(base); return; }
          base.kind = 'run'; base.mode = 'trigger'; base.started_at = iso(start); base._t = start;
          if (st === 'success') {
            var dur = def.dur * (0.7 + 0.6 * r()) * (r() < 0.04 ? 2.4 : 1);
            if (start + dur * 1000 > now) { base.status = 'running'; base.duration_s = null; }
            else { base.status = 'success'; base.duration_s = r1(dur); }
          } else {
            base.status = st; base.duration_s = r1(def.dur * (st === 'crashed' ? 1.4 : 0.1 + 0.5 * r()));
            base.error_node = st === 'crashed' ? null : failNode(r);
          }
          rec(base);
          if (st === 'error' && i < L - bad - 1 && r() < 0.5) {
            var rs = start + (300 + Math.floor(r() * 600)) * 1000;
            if (rs < now - 120000) rec({ kind: 'run', status: 'success', mode: 'retry', started_at: iso(rs), duration_s: r1(def.dur * (0.7 + 0.6 * r())), _t: rs, _day: ljDate(rs) });
          }
        });
      }

      // ── manual runs ────────────────────────────────────────────────────
      if (def.manualP) {
        for (var mk = WINDOW; mk >= 0; mk--) {
          if (mk < (def.endAgo || 0)) continue;
          var mds = dayStr(mk), mr = D.rng(id + '|manual|' + mds);
          if (mr() >= def.manualP) continue;
          var mt = localToUtc(mds, 540 + Math.floor(mr() * 480)) + Math.floor(mr() * 60000);
          if (mt > now) continue;
          var merr = mr() < (def.kind === 'manual' ? def.fail : 0.08);
          rec({ kind: 'run', status: merr ? 'error' : 'success', mode: 'manual', started_at: iso(mt), duration_s: r1(def.dur * (merr ? 0.3 : 0.8 + 0.4 * mr())), error_node: merr ? failNode(mr) : null, _t: mt, _day: mds });
        }
      }

      // ── webhook-triggered runs ─────────────────────────────────────────
      if (def.kind === 'webhook') {
        for (var wk = WINDOW; wk >= 0; wk--) {
          var wds = dayStr(wk), wr = D.rng(id + '|wh|' + wds);
          var cnt = Math.round(def.perDay * D.shape(wds) * (0.8 + 0.4 * wr()));
          for (var c = 0; c < cnt; c++) {
            var wt = localToUtc(wds, 420 + Math.floor(900 * (wr() + wr()) / 2)) + Math.floor(wr() * 60) * 1000;
            if (wt > now) continue;
            var werr = wr() < def.fail;
            rec({ kind: 'run', status: werr ? 'error' : 'success', mode: 'webhook', started_at: iso(wt), duration_s: r1(def.dur * (werr ? 0.3 : 0.6 + 0.8 * wr())), error_node: werr ? failNode(wr) : null, _t: wt, _day: wds });
          }
        }
      }

      built.push({ def: def, id: id, updated: updated, items: items });
    });

    // sub-workflow: called once for every failed run elsewhere
    var sub = built.filter(function (b) { return b.def.kind === 'subworkflow'; })[0];
    if (sub) {
      built.forEach(function (b) {
        if (b === sub) return;
        b.items.forEach(function (it) {
          if (it.kind === 'run' && (it.status === 'error' || it.status === 'crashed')) {
            var t = it._t + 3000 + Math.floor(it.duration_s * 1000);
            if (t < now) sub.items.push({ kind: 'run', workflow_id: sub.id, workflow_name: sub.def.name, status: 'success', mode: 'integrated', started_at: iso(t), expected_at: null, duration_s: 1.8, error_node: null, _t: t, _day: ljDate(t) });
          }
        });
      });
    }

    // ── per-workflow summary ───────────────────────────────────────────
    var start14 = localToUtc(dayStr(13), 0), all = [], slotItems = [];
    var workflows = built.map(function (b) {
      var def = b.def, items = b.items.sort(function (x, y) { return x._t - y._t; });
      var runs = items.filter(function (i) { return i.kind === 'run'; });
      var lastRun = runs[runs.length - 1] || null;
      var lastOk = null, lastFin = null;
      runs.forEach(function (r) { if (r.status === 'success') lastOk = r; if (r.status !== 'running') lastFin = r; });
      var probs = 0;
      for (var i = items.length - 1; i >= 0; i--) {
        var s = items[i].status;
        if (s === 'running' || s === 'due') continue;
        if (s === 'error' || s === 'crashed' || s === 'missed') probs++; else break;
      }
      var sched = items.filter(function (i) { return i._slot; }), latest = sched[sched.length - 1], health = null;
      if (def.active && latest) {
        var ls = latest.status;
        health = (ls === 'error' || ls === 'crashed') ? 'FAILED' : ls === 'missed' ? 'MISSED' : (ls === 'running' || ls === 'due') ? 'IN PROGRESS' : 'OK';
      }
      var r14 = runs.filter(function (r) { return r._t >= start14; });
      var perDay = def.times ? def.times.length * (def.dow ? def.dow.length / 7 : 1) : null;
      items.forEach(function (it) { all.push(it); if (it._slot) slotItems.push(it); });
      return {
        workflow_id: b.id,
        name: def.name,
        active: def.active,
        trigger_kind: def.kind,
        health: health,
        schedule_expr: def.expr || null,
        schedule_desc: def.desc || null,
        expected_runs_per_day: perDay == null ? null : Math.round(perDay * 100) / 100,
        node_count: def.nodes,
        updated_at: iso(b.updated),
        last_started_at: lastRun ? lastRun.started_at : null,
        last_success_at: lastOk ? lastOk.started_at : null,
        last_duration_s: lastFin ? lastFin.duration_s : null,
        problems_since_last_success: probs,
        runs_14d: r14.length,
        failed_14d: r14.filter(function (r) { return r.status === 'error' || r.status === 'crashed'; }).length,
        missed_14d: items.filter(function (i) { return i.status === 'missed' && i._t >= start14; }).length
      };
    });

    var lastTick = Math.floor((now - 20 * 60000) / 3600000) * 3600000 + 20 * 60000; // hourly refresh at :20
    var v = {
      now: now, today: today, dayStr: dayStr,
      workflows: workflows, items: all, slotItems: slotItems,
      meta: {
        executions_loaded_at: iso(lastTick + 45000),
        status_checked_at: iso(lastTick + 90000 > now ? lastTick + 45000 : lastTick + 90000),
        timezone: TZ,
        workflow_count: workflows.length
      }
    };
    cache = { t: now, v: v };
    return v;
  }

  function clampDays(params, dflt) {
    var n = parseInt(params.get('days'), 10);
    if (!(n > 0)) n = dflt;
    return Math.min(n, WINDOW);
  }
  function pub(it) { var o = {}; Object.keys(it).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = it[k]; }); return o; }

  D.register('/api/n8n/', function (path, params) {
    var m = model();
    path = String(path || '').replace(/^\/+|\/+$/g, '');

    if (path === 'workflows') return { workflows: m.workflows };

    if (path === 'meta') return m.meta;

    if (path === 'daily') {
      var nd = clampDays(params, 30), byDay = {}, list = [];
      for (var k = nd - 1; k >= 0; k--) {
        var ds = m.dayStr(k);
        byDay[ds] = { expected_date: ds, expected: 0, success: 0, failed: 0, missed: 0, in_progress: 0 };
        list.push(byDay[ds]);
      }
      m.slotItems.forEach(function (it) {
        var row = byDay[it._day]; if (!row) return;
        row.expected++;
        if (it.status === 'success') row.success++;
        else if (it.status === 'error' || it.status === 'crashed') row.failed++;
        else if (it.status === 'missed') row.missed++;
        else row.in_progress++;
      });
      return { days: list };
    }

    if (path === 'runs') {
      var days = clampDays(params, 14), wf = params.get('workflow');
      var from = localToUtc(m.dayStr(days - 1), 0);
      var out = m.items.filter(function (it) { return it._t >= from && (!wf || it.workflow_id === wf); });
      out.sort(function (a, b) { return b._t - a._t; });
      return { runs: out.map(pub) };
    }

    return { __status: 404, error: 'Not found' };
  });
})();
