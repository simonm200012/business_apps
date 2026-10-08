/* Team Tasks — a Linear-style issue tracker for Adrial Apps.
 *
 * Everything is in this browser (IndexedDB "adrial-team-tasks"), plus the signed-in person's private cloud copy
 * through /_shared/adrial-sync.js (app "tasks"). There is no real login inside the app: "Acting as" picks which
 * workspace member you are, so the inbox, "My issues" and the activity feed follow that person.
 *
 * Layout: sidebar (inbox, my issues, projects, teams → issues / cycles / projects), a list or board per view with
 * grouping, ordering and filters, an issue page with a properties panel, a ⌘K command menu and Linear's
 * single-key shortcuts (C, S, P, A, L, D, E, I, X, J/K, G then a letter). */
(function () {
  'use strict';

  // ── constants ────────────────────────────────────────────────────────────
  const STATUSES = [
    { id: 'backlog', name: 'Backlog', color: 'var(--st-backlog)' },
    { id: 'todo', name: 'Todo', color: 'var(--st-todo)' },
    { id: 'progress', name: 'In Progress', color: 'var(--st-progress)' },
    { id: 'review', name: 'In Review', color: 'var(--st-review)' },
    { id: 'done', name: 'Done', color: 'var(--st-done)' },
    { id: 'canceled', name: 'Canceled', color: 'var(--st-canceled)' }
  ];
  const STATUS = {};
  STATUSES.forEach((s) => { STATUS[s.id] = s; });
  const PRIO_NAME = { 0: 'No priority', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
  const PRIO_MENU = [0, 1, 2, 3, 4];
  const ESTIMATES = [1, 2, 3, 5, 8];
  const PROJECT_STATUSES = [['backlog', 'Backlog'], ['planned', 'Planned'], ['started', 'In progress'], ['paused', 'Paused'], ['completed', 'Completed'], ['canceled', 'Canceled']];
  const COLORS = ['#5B3FE0', '#3E5BA9', '#17869C', '#B4561C', '#3F7D58', '#8A3F7A', '#C2410C', '#55544F'];
  const GROUPS = [['status', 'Status'], ['assignee', 'Assignee'], ['priority', 'Priority'], ['project', 'Project'], ['cycle', 'Cycle'], ['label', 'Label'], ['due', 'Due date'], ['none', 'No grouping']];
  const ORDERS = [['priority', 'Priority'], ['updated', 'Last updated'], ['created', 'Created'], ['due', 'Due date'], ['title', 'Title']];
  const COMPLETED = [['all', 'All'], ['week', 'Past week'], ['month', 'Past month'], ['none', 'None']];
  const PROPS = [['id', 'ID'], ['status', 'Status'], ['priority', 'Priority'], ['labels', 'Labels'], ['project', 'Project'], ['cycle', 'Cycle'], ['due', 'Due date'], ['estimate', 'Estimate'], ['created', 'Created'], ['assignee', 'Assignee']];
  const DEFAULT_PROPS = { id: true, status: true, priority: true, labels: true, project: true, cycle: false, due: true, estimate: false, created: true, assignee: true };
  const DUE_BUCKETS = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'Next 7 days'], ['next', 'In 2 weeks'], ['later', 'Later'], ['none', 'No due date']];
  const FILTER_PROPS = [['status', 'Status'], ['assignee', 'Assignee'], ['priority', 'Priority'], ['label', 'Labels'], ['project', 'Project'], ['cycle', 'Cycle'], ['due', 'Due date']];
  const DAY = 864e5;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ── helpers ──────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = (v) => esc(JSON.stringify(v === undefined ? null : v));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const nowIso = () => new Date().toISOString();
  const uniq = (a) => a.filter((v, k) => a.indexOf(v) === k);
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today() { return ymd(new Date()); }
  function parseYmd(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / DAY); }
  function fmtDay(s) { const d = parseYmd(s); return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''); }
  function fmtIso(iso) { return fmtDay(ymd(new Date(iso))); }
  function fullTime(iso) { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } }
  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd'; if (s < 86400 * 365) return Math.floor(s / 86400 / 30) + 'mo'; return Math.floor(s / 86400 / 365) + 'y';
  }
  function agoLong(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) { const m = Math.floor(s / 60); return m + (m === 1 ? ' minute ago' : ' minutes ago'); }
    if (s < 86400) { const h = Math.floor(s / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    const d = Math.floor(s / 86400); if (d === 1) return 'yesterday'; if (d < 30) return d + ' days ago'; return fmtIso(iso);
  }
  function dueText(s) { const n = daysBetween(today(), s); if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday'; return fmtDay(s); }
  function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function linkify(text) { return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'); }
  function stripTags(html) { return html.replace(/<[^>]+>/g, ''); }

  // ── icons ────────────────────────────────────────────────────────────────
  const I = {
    inbox: '<path d="M2.5 9.5h3l1 1.5h3l1-1.5h3"/><path d="M3.9 3.5h8.2l1.4 6v2.9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9.5z"/>',
    my: '<circle cx="8" cy="5.6" r="2.6"/><path d="M2.9 13.6c.7-2.4 2.7-3.8 5.1-3.8s4.4 1.4 5.1 3.8"/>',
    issues: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/>',
    cycle: '<path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3"/><path d="M13.4 2.6v2.7h-2.7"/>',
    project: '<path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z"/><path d="M2.8 5 8 8l5.2-3M8 8v6"/>',
    search: '<circle cx="7.2" cy="7.2" r="4.5"/><path d="m10.6 10.6 3.1 3.1"/>',
    compose: '<path d="M8.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-5"/><path d="M12.1 1.9a1.3 1.3 0 0 1 1.9 1.9L8.7 9.1l-2.5.6.6-2.5z"/>',
    filter: '<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>',
    display: '<path d="M2.5 4.5h6.2M11.8 4.5h1.7M2.5 11.5h1.7M7.3 11.5h6.2"/><circle cx="10.2" cy="4.5" r="1.6"/><circle cx="5.8" cy="11.5" r="1.6"/>',
    list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>',
    board: '<rect x="2" y="2.5" width="3.6" height="11" rx="1"/><rect x="6.2" y="2.5" width="3.6" height="7" rx="1"/><rect x="10.4" y="2.5" width="3.6" height="9" rx="1"/>',
    plus: '<path d="M8 3.2v9.6M3.2 8h9.6"/>',
    chev: '<path d="m4.5 6 3.5 3.5L11.5 6"/>',
    chevR: '<path d="m6 4.5 3.5 3.5L6 11.5"/>',
    up: '<path d="m4.5 10 3.5-3.5 3.5 3.5"/>',
    down: '<path d="m4.5 6 3.5 3.5L11.5 6"/>',
    x: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
    more: '<circle cx="3.6" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.4" cy="8" r=".9" fill="currentColor"/>',
    link: '<path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.7.7"/><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.7-.7"/>',
    cal: '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>',
    tag: '<path d="M2.5 3.5v3.6a1 1 0 0 0 .3.7l5.6 5.6a1 1 0 0 0 1.4 0l3.4-3.4a1 1 0 0 0 0-1.4L7.6 3a1 1 0 0 0-.7-.3H3.3a.8.8 0 0 0-.8.8z"/><circle cx="5.4" cy="5.6" r=".9" fill="currentColor"/>',
    est: '<path d="M8 2.8 13.2 12H2.8z"/>',
    check: '<path d="m3.5 8.4 3 3 6-6.8"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4"/>',
    gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
    sub: '<path d="M4.5 2.5v5a2 2 0 0 0 2 2h6"/><path d="m10.5 7 2.5 2.5-2.5 2.5"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
    bell: '<path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1 1H3z"/><path d="M6.5 14h3"/>',
    bellOff: '<path d="M4 11.5V7.2a4 4 0 0 1 6.6-3M12 7v4.5l1 1H5"/><path d="M6.5 14h3M2.5 2.5l11 11"/>',
    me: '<circle cx="8" cy="5.6" r="2.6"/><path d="M2.9 13.6c.7-2.4 2.7-3.8 5.1-3.8 1 0 1.9.2 2.6.6"/><path d="m10.6 12.3 1.4 1.4 2.5-2.7"/>',
    key: '<rect x="1.5" y="4" width="13" height="8.5" rx="1.6"/><path d="M4 6.6h.01M6.5 6.6h.01M9 6.6h.01M11.5 6.6h.01M5 9.8h6"/>',
    undo: '<path d="M5.5 4 2.5 7l3 3"/><path d="M2.5 7h7a4 4 0 0 1 0 8h-2"/>',
    back: '<path d="M9.5 3.5 5 8l4.5 4.5"/>',
    open: '<path d="M9 2.5h4.5V7M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>',
    users: '<circle cx="6" cy="5.8" r="2.3"/><path d="M1.8 13c.5-2.1 2.2-3.3 4.2-3.3s3.7 1.2 4.2 3.3"/><path d="M10.4 3.6a2.3 2.3 0 0 1 0 4.4M12 9.9c1.1.5 1.9 1.6 2.2 3.1"/>',
    download: '<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M2.5 13.5h11"/>',
    upload: '<path d="M8 10.5v-8M4.8 5.7 8 2.5l3.2 3.2M2.5 13.5h11"/>',
    reset: '<path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.7L2.8 5.8"/><path d="M2.8 2.8v3h3"/>'
  };
  function ic(name, size, cls) {
    const s = size || 16;
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' width="' + s + '" height="' + s + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[name] + '</svg>';
  }
  function statusIcon(id, size) {
    const s = STATUS[id] || STATUS.todo, z = size || 14;
    const ring = '<circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>';
    let inner;
    if (id === 'backlog') inner = '<circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.4 1.74" stroke-dashoffset=".65"/>';
    else if (id === 'progress') inner = ring + '<path d="M7 7V3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>';
    else if (id === 'review') inner = ring + '<path d="M7 7V3.5a3.5 3.5 0 1 1-3.5 3.5z" fill="currentColor"/>';
    else if (id === 'done') inner = '<circle cx="7" cy="7" r="6.6" fill="currentColor"/><path d="m4.4 7.2 1.8 1.8 3.5-3.7" fill="none" style="stroke:var(--on-dot)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
    else if (id === 'canceled') inner = '<circle cx="7" cy="7" r="6.6" fill="currentColor"/><path d="m4.9 4.9 4.2 4.2M9.1 4.9 4.9 9.1" style="stroke:var(--on-dot)" stroke-width="1.5" stroke-linecap="round"/>';
    else inner = ring;
    return '<svg class="st-ico" width="' + z + '" height="' + z + '" viewBox="0 0 14 14" style="color:' + s.color + '" aria-hidden="true">' + inner + '</svg>';
  }
  function prioIcon(p, size) {
    const z = size || 14;
    if (p === 1) return '<svg class="pr-ico urgent" width="' + z + '" height="' + z + '" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor"/><path d="M7 3.9v3.8" style="stroke:var(--on-dot)" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="10.1" r=".95" style="fill:var(--on-dot)"/></svg>';
    if (!p) return '<svg class="pr-ico" width="' + z + '" height="' + z + '" viewBox="0 0 14 14" aria-hidden="true"><g fill="currentColor" opacity=".75"><rect x="1.5" y="6.3" width="2.6" height="1.4" rx=".6"/><rect x="5.7" y="6.3" width="2.6" height="1.4" rx=".6"/><rect x="9.9" y="6.3" width="2.6" height="1.4" rx=".6"/></g></svg>';
    const lit = p === 2 ? 3 : p === 3 ? 2 : 1;
    const bar = (x, y, h, on) => '<rect x="' + x + '" y="' + y + '" width="2.6" height="' + h + '" rx=".8" fill="currentColor"' + (on ? '' : ' opacity=".28"') + '/>';
    return '<svg class="pr-ico" width="' + z + '" height="' + z + '" viewBox="0 0 14 14" aria-hidden="true">' + bar(1.6, 8, 4.5, true) + bar(5.7, 5, 7.5, lit >= 2) + bar(9.8, 2, 10.5, lit >= 3) + '</svg>';
  }
  function avatar(m, size) {
    const z = size || 18;
    if (!m) return '<svg class="av-none" width="' + z + '" height="' + z + '" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.2 1.8"/><circle cx="8" cy="6.6" r="2" fill="currentColor" opacity=".8"/><path d="M4.6 11.8c.7-1.4 1.9-2.1 3.4-2.1s2.7.7 3.4 2.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    return '<span class="av" style="--av:' + esc(m.color || '#8F8C85') + ';width:' + z + 'px;height:' + z + 'px;font-size:' + Math.round(z * 0.42) + 'px" aria-hidden="true">' + esc(initials(m.name)) + '</span>';
  }
  function projIcon(p, size) {
    const z = size || 14;
    return '<svg class="proj-ico" width="' + z + '" height="' + z + '" viewBox="0 0 16 16" style="color:' + esc(p ? p.color : 'var(--ink3)') + '" aria-hidden="true"><path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  }
  function projStatusIcon(s) {
    const map = { backlog: 'backlog', planned: 'todo', started: 'progress', completed: 'done', canceled: 'canceled' };
    if (s === 'paused') return '<svg width="14" height="14" viewBox="0 0 14 14" style="color:var(--warn)" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 4.8v4.4M8.4 4.8v4.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    return statusIcon(map[s] || 'todo');
  }
  function teamIcon(t, size) { const z = size || 18; return '<span class="team-ico" style="background:' + esc(t.color) + ';width:' + z + 'px;height:' + z + 'px" aria-hidden="true">' + esc((t.name || t.key)[0].toUpperCase()) + '</span>'; }
  function ring(pct, size, color) {
    const z = size || 16, r = z / 2 - 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, pct / 100));
    return '<svg class="ring" width="' + z + '" height="' + z + '" viewBox="0 0 ' + z + ' ' + z + '" aria-hidden="true"><circle cx="' + z / 2 + '" cy="' + z / 2 + '" r="' + r + '" fill="none" stroke="var(--active)" stroke-width="2"/><circle cx="' + z / 2 + '" cy="' + z / 2 + '" r="' + r + '" fill="none" stroke="' + (color || 'var(--accent)') + '" stroke-width="2" stroke-dasharray="' + (c * f).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + z / 2 + ' ' + z / 2 + ')" stroke-linecap="round"/></svg>';
  }

  // ── state & storage ──────────────────────────────────────────────────────
  let db = null, idbOK = true, saveTimer = null, SYNC = null, syncUnmount = null, pendingRemote = false;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('adrial-team-tasks') : null;
  const ui = {
    route: { kind: 'my', tab: 'assigned' }, ctx: null, focus: null, kfocus: false, selected: new Set(), anchor: null,
    filters: {}, search: {}, collapsed: {}, order: [], layer: null, draft: null, comment: {}, teamOpen: {},
    undo: [], lastList: '#/my-issues/assigned', scroll: {}, brk: 'assignee', gPending: false, edit: null, drag: null
  };
  const IDX = { issue: new Map(), ident: new Map(), member: new Map(), team: new Map(), teamKey: new Map(), label: new Map(), project: new Map() };

  let idbP = null;
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('adrial-team-tasks', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function idbTx(mode, fn) {
    idbP = idbP || idbOpen();
    return idbP.then((d) => new Promise((res, rej) => {
      const tx = d.transaction('kv', mode), req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    }));
  }
  const idbGet = () => idbTx('readonly', (s) => s.get('db'));
  const idbPut = (v) => idbTx('readwrite', (s) => s.put(v, 'db'));

  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    db.updatedAt = nowIso();
    const done = () => { if (SYNC) SYNC.changed(); };
    if (!idbOK) { done(); return Promise.resolve(); }
    return idbPut(db).then(() => { if (channel) channel.postMessage({ type: 'changed' }); done(); })
      .catch((e) => { toast('Could not save in this browser: ' + (e && e.message || e)); });
  }
  window.addEventListener('pagehide', () => { if (saveTimer) flush(); });

  function valid(d) { return !!(d && typeof d === 'object' && Array.isArray(d.issues) && Array.isArray(d.members) && Array.isArray(d.teams) && d.teams.length); }
  function ensure() {
    db.schema = 1;
    db.workspace = db.workspace || { name: 'Workspace' };
    db.labels = db.labels || []; db.projects = db.projects || []; db.display = db.display || {}; db.inbox = db.inbox || {};
    if (!db.members.length) db.members.push({ id: uid('m'), name: 'You', color: COLORS[0] });
    if (!db.members.some((m) => m.id === db.me)) db.me = db.members[0].id;
    db.teams.forEach((t) => {
      t.next = t.next || 1; t.cycleDays = t.cycleDays || 14; t.color = t.color || COLORS[0];
      if (!t.cycleStart) { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); t.cycleStart = ymd(d); }
    });
    db.issues.forEach((i) => {
      i.labels = i.labels || []; i.subscribers = i.subscribers || []; i.activity = i.activity || [];
      i.priority = i.priority || 0; i.description = i.description || '';
      if (!STATUS[i.status]) i.status = 'todo';
      if (!i.createdAt) i.createdAt = nowIso(); if (!i.updatedAt) i.updatedAt = i.createdAt;
    });
  }
  function reindex() {
    Object.keys(IDX).forEach((k) => IDX[k].clear());
    db.members.forEach((m) => IDX.member.set(m.id, m));
    db.teams.forEach((t) => { IDX.team.set(t.id, t); IDX.teamKey.set(t.key, t); });
    db.labels.forEach((l) => IDX.label.set(l.id, l));
    db.projects.forEach((p) => IDX.project.set(p.id, p));
    db.issues.forEach((i) => { IDX.issue.set(i.id, i); IDX.ident.set(ident(i), i); });
  }
  const member = (id) => (id ? IDX.member.get(id) || null : null);
  const memberName = (id) => { const m = member(id); return m ? m.name : id ? 'Former member' : 'Nobody'; };
  const team = (id) => IDX.team.get(id) || db.teams[0];
  const issueById = (id) => IDX.issue.get(id) || null;
  const ident = (i) => { const t = IDX.team.get(i.team) || db.teams[0]; return t.key + '-' + i.number; };
  const isClosed = (i) => i.status === 'done' || i.status === 'canceled';
  const firstName = (id) => memberName(id).split(' ')[0];

  // undo keeps whole copies of the editable collections (the workspace is small)
  function snapshot() { return JSON.stringify({ issues: db.issues, projects: db.projects, labels: db.labels, members: db.members, teams: db.teams }); }
  function mutate(msg, fn, opt) {
    const snap = snapshot();
    const r = fn();
    if (r === false) return false;
    ui.undo.push({ snap, msg: msg || 'last change' });
    if (ui.undo.length > 40) ui.undo.shift();
    reindex(); save(); render();
    if (msg && !(opt && opt.quiet)) toast(msg, { label: 'Undo', run: undo });
    return true;
  }
  function undo() {
    const u = ui.undo.pop();
    if (!u) { toast('Nothing to undo'); return; }
    Object.assign(db, JSON.parse(u.snap));
    reindex(); save(); render();
    toast('Undid ' + u.msg.charAt(0).toLowerCase() + u.msg.slice(1));
  }

  // ── cycles ───────────────────────────────────────────────────────────────
  function cycleOf(t, n) { const start = addDays(t.cycleStart, (n - 1) * t.cycleDays); return { n, start, end: addDays(start, t.cycleDays - 1) }; }
  function currentCycle(t) { return Math.max(1, Math.floor(daysBetween(t.cycleStart, today()) / t.cycleDays) + 1); }
  function cycleRange(c) { return fmtDay(c.start) + ' – ' + fmtDay(c.end); }

  // ── issue changes (with activity) ────────────────────────────────────────
  function logChange(i, field, from, to) {
    const last = i.activity[i.activity.length - 1];
    if (last && last.type === 'change' && last.field === field && field !== 'labels' && last.actor === db.me && Date.now() - new Date(last.at) < 120e3) {
      last.to = to; last.at = nowIso();
      if (same(last.from, last.to)) i.activity.pop();
      return;
    }
    i.activity.push({ id: uid('a'), type: 'change', field, from: from == null ? null : from, to: to == null ? null : to, actor: db.me, at: nowIso() });
  }
  function setField(i, field, val) {
    if (!i) return false;
    if (val === undefined) val = null;
    if (field === 'priority' || field === 'estimate') val = val == null ? (field === 'priority' ? 0 : null) : Number(val);
    if (field === 'parent' && val && (val === i.id || descendants(i.id).includes(val))) return false;
    const from = i[field];
    if (same(from, val)) return false;
    i[field] = val;
    const at = nowIso();
    if (field === 'status') { i.completedAt = val === 'done' ? at : null; i.canceledAt = val === 'canceled' ? at : null; }
    if (field === 'assignee' && val && !i.subscribers.includes(val)) i.subscribers.push(val);
    if (field === 'team') { const t = team(val); i.number = t.next++; i.cycle = null; const p = IDX.project.get(i.project); if (p && p.team !== val) i.project = null; }
    i.updatedAt = at;
    logChange(i, field, from, val);
    return true;
  }
  function toggleLabel(i, lid, on) {
    const has = i.labels.includes(lid);
    if (on === has) return false;
    i.labels = on ? i.labels.concat(lid) : i.labels.filter((x) => x !== lid);
    i.updatedAt = nowIso();
    i.activity.push({ id: uid('a'), type: 'change', field: 'labels', from: on ? null : lid, to: on ? lid : null, actor: db.me, at: nowIso() });
    return true;
  }
  function descendants(id) {
    const out = [], stack = [id];
    while (stack.length) { const p = stack.pop(); db.issues.forEach((x) => { if (x.parent === p && !out.includes(x.id)) { out.push(x.id); stack.push(x.id); } }); }
    return out;
  }
  function createIssue(d) {
    const t = team(d.team), at = nowIso();
    const i = {
      id: uid('i'), team: t.id, number: t.next++, title: String(d.title || '').trim(), description: String(d.description || '').trim(),
      status: d.status || 'todo', priority: d.priority || 0, assignee: d.assignee || null, creator: db.me, labels: (d.labels || []).slice(),
      project: d.project || null, cycle: d.cycle == null ? null : d.cycle, due: d.due || null, estimate: d.estimate || null, parent: d.parent || null,
      subscribers: uniq([db.me, d.assignee].filter(Boolean)), sort: 0, createdAt: at, updatedAt: at,
      completedAt: d.status === 'done' ? at : null, canceledAt: d.status === 'canceled' ? at : null,
      activity: [{ id: uid('a'), type: 'create', actor: db.me, at }]
    };
    db.issues.push(i); IDX.issue.set(i.id, i); IDX.ident.set(ident(i), i);
    return i;
  }
  function describe(ev) {
    const b = (s) => '<b>' + esc(s) + '</b>';
    if (ev.type === 'create') return 'created the issue';
    switch (ev.field) {
      case 'status': return 'changed status from ' + b((STATUS[ev.from] || {}).name || 'none') + ' to ' + b((STATUS[ev.to] || {}).name || 'none');
      case 'priority': return ev.to ? 'set priority to ' + b(PRIO_NAME[ev.to]) : 'removed the priority';
      case 'assignee': return ev.to ? (ev.to === ev.actor ? 'self-assigned the issue' : 'assigned the issue to ' + b(memberName(ev.to))) : 'unassigned ' + b(memberName(ev.from));
      case 'labels': { const l = IDX.label.get(ev.to || ev.from); return (ev.to ? 'added label ' : 'removed label ') + b(l ? l.name : 'deleted label'); }
      case 'project': { const p = IDX.project.get(ev.to); return ev.to ? 'moved the issue to ' + b(p ? p.name : 'a deleted project') : 'removed the issue from its project'; }
      case 'cycle': return ev.to ? 'added the issue to ' + b('Cycle ' + ev.to) : 'removed the issue from ' + b('Cycle ' + ev.from);
      case 'due': return ev.to ? 'set the due date to ' + b(fmtDay(ev.to)) : 'removed the due date';
      case 'estimate': return ev.to ? 'set the estimate to ' + b(ev.to + (ev.to === 1 ? ' point' : ' points')) : 'removed the estimate';
      case 'title': return 'renamed the issue' + (ev.from ? ' from <s>' + esc(ev.from) + '</s>' : '');
      case 'parent': { const p = issueById(ev.to); return ev.to ? 'made this a sub-issue of ' + b(p ? ident(p) : 'a deleted issue') : 'removed the parent issue'; }
      case 'team': { const t = IDX.team.get(ev.to); return 'moved the issue to ' + b(t ? t.name : 'another team'); }
      default: return 'updated the issue';
    }
  }

  // ── routing ──────────────────────────────────────────────────────────────
  function parseHash() {
    let h = location.hash.replace(/^#\/?/, ''), query = '';
    const q = h.indexOf('?');
    if (q >= 0) { query = h.slice(q + 1); h = h.slice(0, q); }
    const p = h.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    let r;
    const t = p[1] ? IDX.teamKey.get(p[1].toUpperCase()) : null;
    switch (p[0]) {
      case 'inbox': r = { kind: 'inbox', sel: p[1] || null }; break;
      case 'my-issues': r = { kind: 'my', tab: ['assigned', 'created', 'subscribed'].includes(p[1]) ? p[1] : 'assigned' }; break;
      case 'team':
        if (!t) { r = { kind: 'my', tab: 'assigned' }; break; }
        if (p[2] === 'cycles') r = { kind: 'cycles', team: t.id };
        else if (p[2] === 'cycle') r = { kind: 'cycle', team: t.id, n: p[3] === 'current' || !+p[3] ? currentCycle(t) : +p[3] };
        else if (p[2] === 'projects') r = { kind: 'projects', team: t.id };
        else r = { kind: 'team', team: t.id, tab: ['all', 'active', 'backlog'].includes(p[3]) ? p[3] : 'all' };
        break;
      case 'projects': r = { kind: 'projects', team: null }; break;
      case 'project': r = IDX.project.get(p[1]) ? { kind: 'project', id: p[1] } : { kind: 'projects', team: null }; break;
      case 'issue': r = { kind: 'issue', ident: (p[1] || '').toUpperCase() }; break;
      case 'settings': r = { kind: 'settings' }; break;
      default: r = { kind: 'my', tab: 'assigned' };
    }
    if (query) {
      const params = new URLSearchParams(query), ctx = listCtx(r);
      if (ctx) {
        const patch = {};
        if (params.get('layout') === 'board' || params.get('layout') === 'list') patch.layout = params.get('layout');
        if (GROUPS.some((g) => g[0] === params.get('group'))) patch.groupBy = params.get('group');
        if (Object.keys(patch).length) { db.display[ctx.key] = Object.assign(db.display[ctx.key] || {}, patch); save(); }
      }
      history.replaceState(null, '', '#/' + p.map(encodeURIComponent).join('/'));
    }
    return r;
  }
  function go(hash) { if (location.hash === hash) onRoute(); else location.hash = hash; }
  function onRoute() {
    const prev = ui.route;
    ui.route = parseHash();
    if (listCtx(ui.route)) ui.lastList = location.hash;
    if (prev.kind !== ui.route.kind || prev.team !== ui.route.team || prev.tab !== ui.route.tab || prev.id !== ui.route.id) { ui.selected.clear(); ui.anchor = null; }
    document.getElementById('app').classList.remove('nav-open');
    if (ui.layer && ui.layer.type !== 'create') closeLayer(true);
    render();
    const main = $('main');
    if (main && document.activeElement === document.body) main.focus({ preventScroll: true });
  }

  // ── list contexts, filtering, grouping ───────────────────────────────────
  function listCtx(r) {
    const me = db.me;
    if (r.kind === 'my') {
      const base = r.tab === 'created' ? (i) => i.creator === me : r.tab === 'subscribed' ? (i) => i.subscribers.includes(me) : (i) => i.assignee === me;
      return { key: 'my', base, preset: r.tab === 'assigned' ? { assignee: me } : {}, team: null };
    }
    if (r.kind === 'team') {
      const t = r.team;
      const base = r.tab === 'active' ? (i) => i.team === t && (i.status === 'todo' || i.status === 'progress' || i.status === 'review')
        : r.tab === 'backlog' ? (i) => i.team === t && i.status === 'backlog' : (i) => i.team === t;
      return { key: 'team:' + t, base, preset: { team: t, status: r.tab === 'backlog' ? 'backlog' : 'todo' }, team: t };
    }
    if (r.kind === 'project') { const p = IDX.project.get(r.id); return p ? { key: 'project', base: (i) => i.project === p.id, preset: { project: p.id, team: p.team }, team: p.team } : null; }
    if (r.kind === 'cycle') return { key: 'cycle', base: (i) => i.team === r.team && i.cycle === r.n, preset: { team: r.team, cycle: r.n, status: 'todo' }, team: r.team };
    return null;
  }
  function display(key) {
    const d = db.display[key] || {};
    return { layout: d.layout || 'list', groupBy: d.groupBy || 'status', orderBy: d.orderBy || 'priority', completed: d.completed || 'all', subs: d.subs !== false, props: Object.assign({}, DEFAULT_PROPS, d.props || {}) };
  }
  function setDisplay(key, patch) { db.display[key] = Object.assign(db.display[key] || {}, patch); save(); renderMain(); }
  function completedOk(i, mode) {
    if (!isClosed(i) || mode === 'all') return true;
    if (mode === 'none') return false;
    const at = i.completedAt || i.canceledAt || i.updatedAt;
    return Date.now() - new Date(at) < (mode === 'week' ? 7 : 30) * DAY;
  }
  function dueBucket(i) {
    if (!i.due) return 'none';
    const n = daysBetween(today(), i.due);
    return n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 7 ? 'week' : n <= 14 ? 'next' : 'later';
  }
  function passFilters(i, fs) {
    return fs.every((f) => {
      if (!f.values.length) return true;
      switch (f.prop) {
        case 'status': return f.values.includes(i.status);
        case 'assignee': return f.values.includes(i.assignee || '');
        case 'priority': return f.values.includes(i.priority || 0);
        case 'label': return f.values.some((v) => (v === '' ? !i.labels.length : i.labels.includes(v)));
        case 'project': return f.values.includes(i.project || '');
        case 'cycle': return f.values.includes(i.cycle == null ? '' : i.cycle);
        case 'due': return f.values.includes(dueBucket(i));
        default: return true;
      }
    });
  }
  function sorter(by) {
    const pr = (i) => i.priority || 5;
    switch (by) {
      case 'updated': return (a, b) => cmp(b.updatedAt, a.updatedAt);
      case 'created': return (a, b) => cmp(b.createdAt, a.createdAt);
      case 'due': return (a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || cmp(a.due || '', b.due || '') || pr(a) - pr(b);
      case 'title': return (a, b) => a.title.localeCompare(b.title);
      default: return (a, b) => pr(a) - pr(b) || cmp(b.updatedAt, a.updatedAt);
    }
  }
  function queryIssues(ctx) {
    const d = display(ctx.key), fs = ui.filters[ctx.key] || [], q = (ui.search[ctx.key] || '').trim().toLowerCase();
    return db.issues.filter((i) => ctx.base(i) && (d.subs || !i.parent) && completedOk(i, d.completed) && passFilters(i, fs) &&
      (!q || ident(i).toLowerCase().includes(q) || i.title.toLowerCase().includes(q))).sort(sorter(d.orderBy));
  }
  function groupKey(i, by) {
    switch (by) {
      case 'status': return i.status;
      case 'assignee': return i.assignee && member(i.assignee) ? i.assignee : '';
      case 'priority': return String(i.priority || 0);
      case 'project': return i.project && IDX.project.has(i.project) ? i.project : '';
      case 'cycle': return i.cycle == null ? '' : String(i.cycle);
      case 'label': return i.labels.find((l) => IDX.label.has(l)) || '';
      case 'due': return dueBucket(i);
      default: return 'all';
    }
  }
  function groupDefs(by, items) {
    switch (by) {
      case 'status': return STATUSES.map((s) => ({ key: s.id, field: 'status', value: s.id, label: s.name, icon: statusIcon(s.id) }));
      case 'assignee': {
        const ms = db.members.slice().sort((a, b) => (a.id === db.me ? -1 : b.id === db.me ? 1 : a.name.localeCompare(b.name)));
        return ms.map((m) => ({ key: m.id, field: 'assignee', value: m.id, label: m.name, icon: avatar(m, 16) })).concat({ key: '', field: 'assignee', value: null, label: 'No assignee', icon: avatar(null, 16) });
      }
      case 'priority': return [1, 2, 3, 4, 0].map((p) => ({ key: String(p), field: 'priority', value: p, label: PRIO_NAME[p], icon: prioIcon(p) }));
      case 'project': return db.projects.map((p) => ({ key: p.id, field: 'project', value: p.id, label: p.name, icon: projIcon(p) })).concat({ key: '', field: 'project', value: null, label: 'No project', icon: projIcon(null) });
      case 'cycle': {
        const ns = uniq(items.filter((i) => i.cycle != null).map((i) => i.cycle)).sort((a, b) => b - a);
        return ns.map((n) => ({ key: String(n), field: 'cycle', value: n, label: 'Cycle ' + n, icon: ic('cycle', 14) })).concat({ key: '', field: 'cycle', value: null, label: 'No cycle', icon: ic('cycle', 14) });
      }
      case 'label': return db.labels.map((l) => ({ key: l.id, field: null, label: l.name, icon: '<span class="dot" style="width:9px;height:9px;border-radius:50%;background:' + esc(l.color) + '"></span>' })).concat({ key: '', field: null, label: 'No labels', icon: ic('tag', 14) });
      case 'due': return DUE_BUCKETS.map((b) => ({ key: b[0], field: null, label: b[1], icon: ic('cal', 14) }));
      default: return [{ key: 'all', field: null, label: 'All issues', icon: ic('issues', 14) }];
    }
  }
  function grouped(ctx, items, forBoard) {
    const d = display(ctx.key), defs = groupDefs(d.groupBy, items), map = new Map();
    defs.forEach((g) => { g.items = []; map.set(g.key, g); });
    items.forEach((i) => { const k = groupKey(i, d.groupBy); (map.get(k) || map.get('') || defs[defs.length - 1]).items.push(i); });
    return defs.filter((g) => {
      if (g.items.length) return true;
      if (!forBoard || d.groupBy !== 'status') return false;
      if (g.key === 'canceled') return false;
      if (g.key === 'done' && d.completed === 'none') return false;
      if (ui.route.kind === 'team' && ui.route.tab === 'active' && (g.key === 'backlog' || g.key === 'done')) return false;
      if (ui.route.kind === 'team' && ui.route.tab === 'backlog' && g.key !== 'backlog') return false;
      return true;
    });
  }

  // ── rendering: sidebar ───────────────────────────────────────────────────
  function inboxItems() {
    const me = db.me, st = db.inbox[me] || { read: {}, cleared: {} }, out = [];
    db.issues.forEach((i) => {
      if (!(i.assignee === me || i.creator === me || i.subscribers.includes(me))) return;
      const evs = i.activity.filter((a) => a.actor !== me && (a.type === 'comment' || a.type === 'change' || (a.type === 'create' && i.assignee === me)));
      if (!evs.length) return;
      const ev = evs[evs.length - 1];
      if (st.cleared && st.cleared[i.id] && st.cleared[i.id] >= ev.at) return;
      out.push({ issue: i, ev, unread: !(st.read && st.read[i.id] && st.read[i.id] >= ev.at) });
    });
    return out.sort((a, b) => cmp(b.ev.at, a.ev.at));
  }
  function inboxState() { const s = db.inbox[db.me] || (db.inbox[db.me] = {}); s.read = s.read || {}; s.cleared = s.cleared || {}; return s; }

  function navItem(href, icon, label, on, extra, cls) {
    return '<a class="nav-item' + (cls ? ' ' + cls : '') + (on ? ' on' : '') + '" href="' + href + '"' + (on ? ' aria-current="page"' : '') + '>' + icon + '<span class="nav-l">' + esc(label) + '</span>' + (extra || '') + '</a>';
  }
  function renderSide() {
    const r = ui.route, me = member(db.me);
    const unread = inboxItems().filter((x) => x.unread).length;
    const mine = db.issues.filter((i) => i.assignee === db.me && !isClosed(i)).length;
    let h = '<div class="brand"><span class="brand-tile" aria-hidden="true">' + ic('issues', 20) + '</span><span class="brand-text"><b>Team Tasks</b><small>' + esc(db.workspace.name) + ' · ' + db.teams.length + (db.teams.length === 1 ? ' team' : ' teams') + '</small></span></div>';
    h += '<button type="button" class="me-card" data-act="act-as" title="Switch who you are acting as">' + avatar(me, 36) + '<span class="me-text"><b>' + esc(me ? me.name : '—') + '</b><small>Acting as</small></span>' + ic('chev', 14) + '</button>';
    h += '<nav class="nav" aria-label="Sections">';
    h += navItem('#/inbox', ic('inbox', 18), 'Inbox', r.kind === 'inbox', unread ? '<span class="badge" aria-label="' + unread + ' unread">' + unread + '</span>' : '');
    h += navItem('#/my-issues/assigned', ic('my', 18), 'My issues', r.kind === 'my', mine ? '<span class="count">' + mine + '</span>' : '');
    h += '<div class="nav-label">Workspace</div>';
    h += navItem('#/projects', ic('project', 18), 'Projects', r.kind === 'projects' && !r.team, '<span class="count">' + db.projects.length + '</span>');
    h += '<div class="nav-label">Teams</div>';
    db.teams.forEach((t) => {
      const open = ui.teamOpen[t.id] !== false;
      const n = db.issues.filter((i) => i.team === t.id && !isClosed(i)).length;
      h += '<button type="button" class="nav-item team-row" data-act="team-toggle" data-id="' + t.id + '" aria-expanded="' + open + '">' + teamIcon(t, 20) + '<span class="nav-l">' + esc(t.name) + '</span><span class="count">' + n + '</span>' + ic('chev', 12, 'caret') + '</button>';
      if (!open) return;
      h += '<div class="nav-sub">' +
        navItem('#/team/' + t.key + '/issues/all', ic('issues', 16), 'Issues', r.kind === 'team' && r.team === t.id) +
        navItem('#/team/' + t.key + '/cycles', ic('cycle', 16), 'Cycles', (r.kind === 'cycles' || r.kind === 'cycle') && r.team === t.id, '<span class="tag">' + currentCycle(t) + '</span>') +
        navItem('#/team/' + t.key + '/projects', ic('project', 16), 'Projects', r.kind === 'projects' && r.team === t.id) + '</div>';
    });
    h += '</nav><div class="side-foot">' + navItem('#/settings', ic('gear', 18), 'Settings', r.kind === 'settings') +
      '<p class="demo-note">Demo workspace · saved in this browser, plus your private cloud copy when you sign in. Not shared with teammates.</p></div>';
    $('side').innerHTML = h;
  }

  // ── rendering: main ──────────────────────────────────────────────────────
  function topline() {
    return '<div class="topline"><button type="button" class="round menu-toggle" data-act="nav" aria-label="Open navigation">' + ic('menu') + '</button>' +
      '<button type="button" class="searchbar" data-act="palette" aria-label="Search and commands (⌘K)">' + ic('search') + '<span>Search issues, projects or commands</span><kbd>⌘K</kbd></button>' +
      '<div class="grow"></div><button type="button" class="btn primary" data-act="create">' + ic('plus') + '<span>New issue</span><kbd>C</kbd></button></div>';
  }
  function head(o) {
    return '<header class="head">' + (o.eyebrow ? '<div class="eyebrow">' + o.eyebrow + '</div>' : '') +
      '<div class="head-row"><h1 class="title">' + esc(o.title) + '<span class="stop" aria-hidden="true">.</span></h1>' + (o.right ? '<div class="head-actions">' + o.right + '</div>' : '') + '</div>' +
      (o.sub ? '<p class="sub">' + o.sub + '</p>' : '') + '</header>';
  }
  const tab = (href, label, on) => '<a class="seg-i' + (on ? ' on' : '') + '" href="' + href + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>';
  const crumb = (href, label) => '<a href="' + esc(href) + '">' + esc(label) + '</a>';
  const slash = '<span class="sl" aria-hidden="true">/</span>';
  const round = (act, icon, label, extra) => '<button type="button" class="round" data-act="' + act + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + (extra || '') + '>' + ic(icon) + '</button>';
  function stats(list) {
    const open = list.filter((i) => !isClosed(i)).length, started = list.filter((i) => i.status === 'progress' || i.status === 'review').length;
    const overdue = list.filter((i) => !isClosed(i) && i.due && i.due < today()).length;
    return list.length + (list.length === 1 ? ' issue' : ' issues') + ' · ' + open + ' open · ' + started + ' in progress' + (overdue ? ' · <span class="bad">' + overdue + ' overdue</span>' : '');
  }

  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.dataset || !a.dataset.keep) return null;
    let s = null, e = null;
    try { s = a.selectionStart; e = a.selectionEnd; } catch (x) { /* not a text field */ }
    return { key: a.dataset.keep, s, e };
  }
  function restoreFocus(k) {
    if (!k) return;
    const el = document.querySelector('[data-keep="' + (window.CSS && CSS.escape ? CSS.escape(k.key) : k.key) + '"]');
    if (!el) return;
    el.focus({ preventScroll: true });
    try { if (k.s != null) el.setSelectionRange(k.s, k.e); } catch (x) { /* not a text field */ }
  }
  function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

  function render() { if (!db) return; renderSide(); renderMain(); renderBulk(); }
  function renderMain() {
    const keep = captureFocus(), main = $('main');
    document.querySelectorAll('[data-sk]').forEach((el) => { ui.scroll[el.dataset.sk] = [el.scrollTop, el.scrollLeft]; });
    if (ui.mainKey) ui.scroll['main:' + ui.mainKey] = [main.scrollTop, 0];
    let html;
    const r = ui.route;
    ui.ctx = listCtx(r);
    switch (r.kind) {
      case 'inbox': html = viewInbox(r); break;
      case 'issue': html = viewIssuePage(r); break;
      case 'projects': html = viewProjects(r); break;
      case 'project': html = viewProject(r); break;
      case 'cycles': html = viewCycles(r); break;
      case 'cycle': html = viewCycle(r); break;
      case 'settings': html = viewSettings(); break;
      case 'team': html = viewTeam(r); break;
      default: html = viewMy(r);
    }
    main.innerHTML = '<div class="page page-' + r.kind + '">' + html + '</div>';
    document.querySelectorAll('[data-sk]').forEach((el) => { const s = ui.scroll[el.dataset.sk]; if (s) { el.scrollTop = s[0]; el.scrollLeft = s[1]; } });
    document.querySelectorAll('textarea[data-auto]').forEach(autosize);
    ui.mainKey = location.hash;
    const ms = ui.scroll['main:' + ui.mainKey];
    main.scrollTop = ms ? ms[0] : 0;
    restoreFocus(keep);
    afterRender();
    const titles = { inbox: 'Inbox', my: 'My issues', team: (IDX.team.get(r.team) || {}).name, projects: 'Projects', cycles: 'Cycles', cycle: 'Cycle ' + r.n, settings: 'Settings' };
    let t = titles[r.kind];
    if (r.kind === 'issue') { const i = IDX.ident.get(r.ident); t = i ? ident(i) + ' ' + i.title : 'Issue'; }
    if (r.kind === 'project') { const p = IDX.project.get(r.id); t = p ? p.name : 'Project'; }
    document.title = (t ? t + ' · ' : '') + 'Team Tasks';
  }
  function afterRender() {
    if (syncUnmount) { syncUnmount(); syncUnmount = null; }
    const slot = $('syncSlot');
    if (slot) {
      if (SYNC) syncUnmount = SYNC.mountPanel(slot);
      else slot.innerHTML = '<p class="muted">Cloud sync is not available here, so this workspace stays in this browser.</p>';
    }
  }

  // list page shell shared by My issues, team issues, project and cycle pages
  function layoutSeg(d) {
    return '<div class="seg icons" role="group" aria-label="Layout">' +
      '<button type="button" data-act="layout" data-v="list" class="seg-i' + (d.layout === 'list' ? ' on' : '') + '" aria-pressed="' + (d.layout === 'list') + '" title="List">' + ic('list') + '<span class="sr">List</span></button>' +
      '<button type="button" data-act="layout" data-v="board" class="seg-i' + (d.layout === 'board' ? ' on' : '') + '" aria-pressed="' + (d.layout === 'board') + '" title="Board">' + ic('board') + '<span class="sr">Board</span></button></div>';
  }
  function toolbar(ctx, tabs) {
    const d = display(ctx.key);
    return '<div class="toolbar">' + (tabs ? '<nav class="seg" aria-label="Views">' + tabs + '</nav>' : '') + '<div class="grow"></div>' +
      '<label class="search-in">' + ic('search') + '<span class="sr">Search issues</span><input type="search" data-keep="search:' + esc(ctx.key) + '" data-act-input="search" placeholder="Search title or ID" value="' + esc(ui.search[ctx.key] || '') + '"></label>' +
      '<button type="button" class="btn" data-act="filter">' + ic('filter') + 'Filter</button>' +
      '<button type="button" class="btn" data-act="display">' + ic('display') + 'Display</button>' + layoutSeg(d) + '</div>' + chipsRow(ctx);
  }
  function chipsRow(ctx) {
    const fs = (ui.filters[ctx.key] || []).filter((f) => f.values.length);
    if (!fs.length) return '';
    let h = '<div class="chips-row"><span class="mono-l">Filtered by</span>';
    fs.forEach((f) => {
      const name = FILTER_PROPS.find((p) => p[0] === f.prop)[1];
      const vals = f.values.map((v) => filterValueLabel(f.prop, v));
      h += '<span class="fchip"><span>' + esc(name) + '</span><span class="muted">' + (f.values.length > 1 ? 'is any of' : 'is') + '</span>' +
        '<button type="button" data-act="filter-edit" data-prop="' + f.prop + '"><b>' + esc(vals.length > 2 ? vals.length + ' values' : vals.join(', ')) + '</b></button>' +
        '<button type="button" class="x" data-act="filter-del" data-prop="' + f.prop + '" aria-label="Remove ' + esc(name) + ' filter">' + ic('x', 14) + '</button></span>';
    });
    return h + '<button type="button" class="btn ghost sm" data-act="filter-clear">Clear all</button></div>';
  }
  function listPage(ctx, h, tabs, extra) {
    return topline() + head(h) + (extra || '') + toolbar(ctx, tabs) + '<div id="listBody">' + listBody(ctx) + '</div>';
  }
  function filterValueLabel(prop, v) {
    switch (prop) {
      case 'status': return STATUS[v] ? STATUS[v].name : v;
      case 'assignee': return v ? memberName(v) : 'No assignee';
      case 'priority': return PRIO_NAME[v];
      case 'label': { const l = IDX.label.get(v); return v ? (l ? l.name : 'Deleted') : 'No labels'; }
      case 'project': { const p = IDX.project.get(v); return v ? (p ? p.name : 'Deleted') : 'No project'; }
      case 'cycle': return v === '' ? 'No cycle' : 'Cycle ' + v;
      case 'due': return (DUE_BUCKETS.find((b) => b[0] === v) || [v, v])[1];
      default: return String(v);
    }
  }
  function listBody(ctx) {
    const d = display(ctx.key), items = queryIssues(ctx);
    ui.order = [];
    if (!items.length) {
      const filtered = (ui.filters[ctx.key] || []).some((f) => f.values.length) || (ui.search[ctx.key] || '').trim();
      return '<div class="empty">' + ic(filtered ? 'filter' : 'issues', 32) + '<b>' + (filtered ? 'No issues match these filters' : 'No issues here yet') + '</b>' +
        (filtered ? '<button type="button" class="btn" data-act="filter-clear">Clear filters</button>' : '<span>Press <kbd>C</kbd> to create one.</span><button type="button" class="btn primary" data-act="create">' + ic('plus') + 'New issue</button>') + '</div>';
    }
    return d.layout === 'board' ? boardHtml(ctx, items, d) : listHtml(ctx, items, d);
  }
  function listHtml(ctx, items, d) {
    const groups = grouped(ctx, items, false);
    let h = '<div class="groups">';
    groups.forEach((g) => {
      const ck = ctx.key + '|' + d.groupBy + '|' + g.key, col = !!ui.collapsed[ck];
      h += '<section class="gcard' + (col ? ' collapsed' : '') + '" aria-label="' + esc(g.label) + '">';
      if (d.groupBy !== 'none') {
        h += '<div class="ghead"><button type="button" class="gt" data-act="collapse" data-ck="' + esc(ck) + '" aria-expanded="' + !col + '" aria-label="' + (col ? 'Expand ' : 'Collapse ') + esc(g.label) + '">' + ic('chev', 14) + '</button>' +
          g.icon + '<span class="gname">' + esc(g.label) + '</span><span class="gcount">' + g.items.length + '</span>' +
          (g.field ? '<button type="button" class="round sm gadd" data-act="gadd" data-gfield="' + g.field + '" data-gval="' + attr(g.value) + '" aria-label="New issue in ' + esc(g.label) + '" title="New issue">' + ic('plus') + '</button>' : '') + '</div>';
      }
      if (!col) {
        h += '<div class="rows" role="list">';
        g.items.forEach((i) => { ui.order.push(i.id); h += rowHtml(i, d.props); });
        h += '</div>';
      }
      h += '</section>';
    });
    return h + '</div>';
  }
  function chipLabels(i, max) {
    const ls = i.labels.map((l) => IDX.label.get(l)).filter(Boolean);
    let h = ls.slice(0, max).map((l) => '<span class="chip"><span class="dot" style="background:' + esc(l.color) + '"></span><span>' + esc(l.name) + '</span></span>').join('');
    if (ls.length > max) h += '<span class="chip" title="' + esc(ls.slice(max).map((l) => l.name).join(', ')) + '">+' + (ls.length - max) + '</span>';
    return h;
  }
  function dueChip(i) {
    if (!i.due) return '';
    const n = daysBetween(today(), i.due), cls = !isClosed(i) && n < 0 ? ' overdue' : !isClosed(i) && n <= 2 ? ' soon' : '';
    return '<span class="chip' + cls + '" title="Due ' + esc(fmtDay(i.due)) + '">' + ic('cal', 12) + '<span>' + esc(dueText(i.due)) + '</span></span>';
  }
  function subCount(i) {
    const subs = db.issues.filter((x) => x.parent === i.id);
    if (!subs.length) return '';
    return '<span class="subcount" title="Sub-issues done">' + ic('sub', 12) + subs.filter((x) => x.status === 'done').length + '/' + subs.length + '</span>';
  }
  function rowCls(i) { return (ui.focus === i.id ? ' focus' + (ui.kfocus ? ' kfocus' : '') : '') + (ui.selected.has(i.id) ? ' sel' : ''); }
  function rowHtml(i, P) {
    const p = IDX.project.get(i.project), parent = !P.noParent && i.parent && issueById(i.parent);
    const id = ident(i);
    return '<div class="row' + rowCls(i) + '" role="listitem" data-row="' + i.id + '">' +
      '<label class="row-check"><input type="checkbox" data-act="sel" data-id="' + i.id + '"' + (ui.selected.has(i.id) ? ' checked' : '') + ' aria-label="Select ' + id + '"></label>' +
      (P.priority ? '<button type="button" class="pbtn" data-pick="priority" data-id="' + i.id + '" aria-label="Priority: ' + PRIO_NAME[i.priority || 0] + '" title="Priority: ' + PRIO_NAME[i.priority || 0] + '">' + prioIcon(i.priority) + '</button>' : '') +
      (P.id ? '<span class="ident">' + id + '</span>' : '') +
      (P.status ? '<button type="button" class="pbtn" data-pick="status" data-id="' + i.id + '" aria-label="Status: ' + STATUS[i.status].name + '" title="' + STATUS[i.status].name + '">' + statusIcon(i.status) + '</button>' : '') +
      '<a class="row-title" href="#/issue/' + id + '"><span>' + esc(i.title) + '</span>' + (parent ? '<span class="ptitle">› ' + esc(parent.title) + '</span>' : '') + '</a>' + subCount(i) +
      '<span class="row-meta">' + (P.labels ? chipLabels(i, 2) : '') +
      (P.project && p ? '<span class="chip proj">' + projIcon(p, 12) + '<span>' + esc(p.name) + '</span></span>' : '') +
      (P.cycle && i.cycle != null ? '<span class="chip cyc">' + ic('cycle', 12) + '<span>Cycle ' + i.cycle + '</span></span>' : '') +
      (P.due ? dueChip(i) : '') +
      (P.estimate && i.estimate ? '<span class="chip" title="Estimate">' + ic('est', 12) + '<span>' + i.estimate + '</span></span>' : '') +
      (P.created ? '<span class="when" title="Created ' + esc(fullTime(i.createdAt)) + '">' + fmtIso(i.createdAt) + '</span>' : '') +
      (P.assignee ? '<button type="button" class="pbtn av-btn" data-pick="assignee" data-id="' + i.id + '" aria-label="Assignee: ' + esc(i.assignee ? memberName(i.assignee) : 'nobody') + '" title="' + esc(i.assignee ? memberName(i.assignee) : 'Unassigned') + '">' + avatar(member(i.assignee), 24) + '</button>' : '') +
      '</span></div>';
  }
  function boardHtml(ctx, items, d) {
    const groups = grouped(ctx, items, true), P = d.props;
    let h = '<div class="board-wrap" data-sk="board:' + esc(location.hash) + '"><div class="board">';
    groups.forEach((g) => {
      h += '<section class="col" aria-label="' + esc(g.label) + '"><div class="col-head">' + g.icon + '<span class="gname">' + esc(g.label) + '</span><span class="gcount">' + g.items.length + '</span>' +
        (g.field ? '<button type="button" class="round sm" data-act="gadd" data-gfield="' + g.field + '" data-gval="' + attr(g.value) + '" aria-label="New issue in ' + esc(g.label) + '" title="New issue">' + ic('plus') + '</button>' : '') + '</div>' +
        '<div class="col-body"' + (g.field ? ' data-gfield="' + g.field + '" data-gval="' + attr(g.value) + '"' : '') + '>';
      g.items.forEach((i) => {
        ui.order.push(i.id);
        const p = IDX.project.get(i.project);
        h += '<article class="card' + rowCls(i) + '" data-row="' + i.id + '" draggable="true">' +
          '<div class="card-top">' + (P.id ? '<span class="ident">' + ident(i) + '</span>' : '') +
          (P.assignee ? '<button type="button" class="pbtn av-btn" data-pick="assignee" data-id="' + i.id + '" aria-label="Assignee: ' + esc(i.assignee ? memberName(i.assignee) : 'nobody') + '">' + avatar(member(i.assignee), 24) + '</button>' : '') + '</div>' +
          '<div class="card-title">' + (P.status && d.groupBy !== 'status' ? '<button type="button" class="pbtn" data-pick="status" data-id="' + i.id + '" aria-label="Status: ' + STATUS[i.status].name + '">' + statusIcon(i.status) + '</button>' : '') +
          '<a href="#/issue/' + ident(i) + '">' + esc(i.title) + '</a></div>' +
          '<div class="card-meta">' + (P.priority ? '<button type="button" class="pbtn boxed" data-pick="priority" data-id="' + i.id + '" aria-label="Priority: ' + PRIO_NAME[i.priority || 0] + '">' + prioIcon(i.priority) + '</button>' : '') +
          (P.labels ? chipLabels(i, 2) : '') + (P.due ? dueChip(i) : '') + (P.project && p ? '<span class="chip">' + projIcon(p, 12) + '<span>' + esc(p.name) + '</span></span>' : '') +
          (P.cycle && i.cycle != null ? '<span class="chip">' + ic('cycle', 12) + '<span>Cycle ' + i.cycle + '</span></span>' : '') +
          (P.estimate && i.estimate ? '<span class="chip">' + ic('est', 12) + '<span>' + i.estimate + '</span></span>' : '') + subCount(i) + '</div></article>';
      });
      h += '</div>' + (g.field ? '<button type="button" class="col-add" data-act="gadd" data-gfield="' + g.field + '" data-gval="' + attr(g.value) + '">' + ic('plus') + 'New issue</button>' : '') + '</section>';
    });
    return h + '</div></div>';
  }
  function refreshList() {
    if (!ui.ctx || !$('listBody')) return;
    $('listBody').innerHTML = listBody(ui.ctx);
  }

  // views
  function viewMy(r) {
    const me = member(db.me), mine = db.issues.filter(ui.ctx.base);
    const tabs = tab('#/my-issues/assigned', 'Assigned', r.tab === 'assigned') + tab('#/my-issues/created', 'Created', r.tab === 'created') + tab('#/my-issues/subscribed', 'Subscribed', r.tab === 'subscribed');
    return listPage(ui.ctx, { eyebrow: esc(me ? me.name : '') + slash + 'Personal', title: 'My issues', sub: stats(mine) }, tabs);
  }
  function viewTeam(r) {
    const t = team(r.team), base = '#/team/' + t.key + '/issues/', all = db.issues.filter((i) => i.team === t.id), cur = currentCycle(t), c = cycleOf(t, cur);
    const tabs = tab(base + 'all', 'All issues', r.tab === 'all') + tab(base + 'active', 'Active', r.tab === 'active') + tab(base + 'backlog', 'Backlog', r.tab === 'backlog');
    return listPage(ui.ctx, { eyebrow: teamIcon(t, 16) + esc(t.key) + slash + 'Team', title: t.name, sub: stats(all) + ' · <a href="#/team/' + t.key + '/cycle/' + cur + '">cycle ' + cur + '</a> ends ' + esc(fmtDay(c.end)) }, tabs);
  }

  function viewIssuePage(r) {
    const i = IDX.ident.get(r.ident);
    if (!i) {
      return topline() + head({ eyebrow: crumb(ui.lastList, 'Issues'), title: r.ident, sub: 'This issue does not exist. It may have been deleted or moved to another team.' }) +
        '<a class="btn" href="' + esc(ui.lastList) + '">' + ic('back') + 'Back to issues</a>';
    }
    const t = team(i.team), pos = ui.order.indexOf(i.id);
    const actions = (pos >= 0 ? '<span class="pos">' + (pos + 1) + ' / ' + ui.order.length + '</span>' +
      round('issue-step', 'up', 'Previous issue (K)', ' data-v="-1"' + (pos > 0 ? '' : ' disabled')) + round('issue-step', 'down', 'Next issue (J)', ' data-v="1"' + (pos < ui.order.length - 1 ? '' : ' disabled')) : '') +
      '<button type="button" class="round" data-act="copy-link" data-id="' + i.id + '" aria-label="Copy link" title="Copy link">' + ic('link') + '</button>' +
      '<button type="button" class="round" data-act="issue-menu" data-id="' + i.id + '" aria-label="More actions" title="More actions  ⌘K">' + ic('more') + '</button>' +
      '<a class="round" href="' + esc(ui.lastList) + '" aria-label="Close (Esc)" title="Close  Esc">' + ic('x') + '</a>';
    return topline() + '<div class="issue-head"><div class="eyebrow">' + teamIcon(t, 16) + crumb('#/team/' + t.key + '/issues/all', t.name) + slash + '<span>' + ident(i) + '</span>' + slash + '<span>created ' + fmtIso(i.createdAt) + ' by ' + esc(memberName(i.creator)) + '</span></div><div class="head-actions">' + actions + '</div></div>' + issueBody(i, false);
  }
  function issueBody(i, embedded) {
    const parent = i.parent && issueById(i.parent);
    const subs = db.issues.filter((x) => x.parent === i.id).sort((a, b) => cmp(a.createdAt, b.createdAt));
    const subDone = subs.filter((x) => x.status === 'done').length;
    let h = '<div class="issue' + (embedded ? ' embedded' : '') + '"><div class="issue-main">';
    if (parent) h += '<a class="parent-link" href="#/issue/' + ident(parent) + '">' + statusIcon(parent.status, 12) + '<span class="ident">' + ident(parent) + '</span>' + esc(parent.title) + '</a>';
    h += '<label class="sr" for="it-' + i.id + '">Title</label><textarea id="it-' + i.id + '" class="issue-title" rows="1" data-auto data-keep="title:' + i.id + '" data-field="title" data-id="' + i.id + '" spellcheck="true">' + esc(i.title) + '</textarea>';
    h += issuePills(i, !embedded);
    h += '<label class="sr" for="id-' + i.id + '">Description</label><textarea id="id-' + i.id + '" class="issue-desc" rows="2" data-auto data-keep="desc:' + i.id + '" data-field="description" data-id="' + i.id + '" placeholder="Add a description…">' + esc(i.description) + '</textarea>';
    // sub-issues
    h += '<section class="issue-section"><div class="sec-head"><h2 class="mono-l">Sub-issues</h2>' + (subs.length ? '<span class="subcount">' + ring(subDone * 100 / subs.length, 14) + subDone + '/' + subs.length + '</span>' : '') + '</div><div class="subs">';
    const P = Object.assign({}, DEFAULT_PROPS, { project: false, created: false, labels: false, noParent: true });
    subs.forEach((s) => { h += rowHtml(s, P); });
    h += '<div class="sub-add">' + ic('plus') + '<label class="sr" for="subIn">New sub-issue title</label><input id="subIn" data-keep="sub:' + i.id + '" data-act-input="sub" data-id="' + i.id + '" placeholder="Add a sub-issue and press Enter" autocomplete="off"></div></div></section>';
    // activity
    const subscribed = i.subscribers.includes(db.me);
    h += '<section class="issue-section"><div class="sec-head"><h2 class="mono-l">Activity</h2><div class="grow"></div><button type="button" class="btn ghost sm" data-act="subscribe" data-id="' + i.id + '">' + ic(subscribed ? 'bellOff' : 'bell') + (subscribed ? 'Unsubscribe' : 'Subscribe') + '</button></div><div class="feed">';
    i.activity.forEach((ev) => {
      const m = member(ev.actor);
      if (ev.type === 'comment') {
        h += '<div class="cmt"><div class="cmt-head">' + avatar(m, 24) + '<b>' + esc(memberName(ev.actor)) + '</b><span class="t" title="' + esc(fullTime(ev.at)) + '">' + agoLong(ev.at) + '</span>' +
          (ev.actor === db.me ? '<button type="button" class="round sm" data-act="comment-del" data-id="' + i.id + '" data-ev="' + ev.id + '" aria-label="Delete comment" title="Delete comment">' + ic('trash') + '</button>' : '') +
          '</div><div class="cmt-body">' + linkify(ev.text) + '</div></div>';
      } else {
        const iconHtml = ev.field === 'status' ? statusIcon(ev.to, 14) : ev.field === 'priority' ? prioIcon(ev.to, 14) : avatar(m, 20);
        h += '<div class="ev"><span class="ev-ico">' + iconHtml + '</span><span><b>' + esc(memberName(ev.actor)) + '</b> ' + describe(ev) + ' <span class="t" title="' + esc(fullTime(ev.at)) + '">· ' + agoLong(ev.at) + '</span></span></div>';
      }
    });
    h += '</div><div class="composer"><label class="sr" for="cmtIn">Comment</label><textarea id="cmtIn" rows="1" data-auto data-keep="cmt:' + i.id + '" data-act-input="comment" data-id="' + i.id + '" placeholder="Leave a comment…">' + esc(ui.comment[i.id] || '') + '</textarea>' +
      '<div class="composer-foot"><span class="mono-s"><kbd>⌘</kbd> <kbd>↵</kbd> to send</span><button type="button" class="btn primary sm" data-act="comment" data-id="' + i.id + '">Comment</button></div></div></section>';
    h += '</div>';
    if (!embedded) h += issueSide(i);
    return h + '</div>';
  }
  function propValues(i) {
    const p = IDX.project.get(i.project), t = team(i.team), cyc = i.cycle != null ? cycleOf(t, i.cycle) : null;
    const labels = i.labels.map((l) => IDX.label.get(l)).filter(Boolean);
    const overdue = i.due && !isClosed(i) && i.due < today();
    return [
      ['Status', 'status', statusIcon(i.status) + '<span>' + STATUS[i.status].name + '</span>'],
      ['Priority', 'priority', prioIcon(i.priority) + '<span' + (i.priority ? '' : ' class="muted"') + '>' + PRIO_NAME[i.priority || 0] + '</span>'],
      ['Assignee', 'assignee', avatar(member(i.assignee), 22) + '<span' + (i.assignee ? '' : ' class="muted"') + '>' + esc(i.assignee ? memberName(i.assignee) : 'Assign') + '</span>'],
      ['Labels', 'labels', labels.length ? labels.map((l) => '<span class="chip"><span class="dot" style="background:' + esc(l.color) + '"></span><span>' + esc(l.name) + '</span></span>').join('') : ic('tag', 14) + '<span class="muted">Add label</span>'],
      ['Project', 'project', projIcon(p) + '<span' + (p ? '' : ' class="muted"') + '>' + esc(p ? p.name : 'Add to project') + '</span>'],
      ['Cycle', 'cycle', ic('cycle', 14) + '<span' + (cyc ? ' title="' + esc(cycleRange(cyc)) + '"' : ' class="muted"') + '>' + (cyc ? 'Cycle ' + cyc.n + (cyc.n === currentCycle(t) ? ' <span class="muted">· current</span>' : '') : 'Add to cycle') + '</span>'],
      ['Due date', 'due', ic('cal', 14) + '<span' + (i.due ? (overdue ? ' class="bad"' : '') : ' class="muted"') + '>' + (i.due ? esc(fmtDay(i.due) + (/^\w{3} \d/.test(dueText(i.due)) ? '' : ' · ' + dueText(i.due))) : 'Set due date') + '</span>'],
      ['Estimate', 'estimate', ic('est', 14) + '<span' + (i.estimate ? '' : ' class="muted"') + '>' + (i.estimate ? i.estimate + (i.estimate === 1 ? ' point' : ' points') : 'Set estimate') + '</span>'],
      ['Team', 'team', teamIcon(t, 18) + '<span>' + esc(t.name) + '</span>']
    ];
  }
  function issueSide(i) {
    const prop = (v) => '<div class="prop"><span class="prop-l">' + v[0] + '</span><button type="button" class="prop-v' + (v[1] === 'labels' ? ' wrap' : '') + '" data-pick="' + v[1] + '" data-id="' + i.id + '" aria-label="' + v[0] + '">' + v[2] + '</button></div>';
    const vals = propValues(i);
    return '<aside class="issue-side" aria-label="Properties"><div class="side-card">' + vals.slice(0, 4).map(prop).join('') + '<div class="prop-sep"></div>' + vals.slice(4).map(prop).join('') + '</div>' +
      '<div class="side-meta mono-s"><span>Created ' + fmtIso(i.createdAt) + ' by ' + esc(memberName(i.creator)) + '</span><span>Updated ' + agoLong(i.updatedAt) + '</span>' +
      (i.completedAt ? '<span>Completed ' + fmtIso(i.completedAt) + '</span>' : '') + '</div></aside>';
  }
  function issuePills(i, narrowOnly) {
    return '<div class="issue-pills' + (narrowOnly ? ' narrow-only' : '') + '">' + propValues(i).filter((v) => v[1] !== 'team').map((v) => '<button type="button" class="pill" data-pick="' + v[1] + '" data-id="' + i.id + '" aria-label="' + v[0] + '">' + v[2] + '</button>').join('') + '</div>';
  }

  function viewInbox(r) {
    const items = inboxItems(), st = inboxState();
    const sel = r.sel ? IDX.ident.get(r.sel) : null;
    if (sel) {
      const it = items.find((x) => x.issue === sel);
      if (it && it.unread) { st.read[sel.id] = nowIso(); it.unread = false; save(); setTimeout(renderSide, 0); }
    }
    ui.order = items.map((x) => x.issue.id);
    const unread = items.filter((x) => x.unread).length;
    const right = unread ? '<button type="button" class="btn" data-act="inbox-readall">' + ic('check') + 'Mark all as read</button>' : '';
    let h = topline() + head({ eyebrow: esc(memberName(db.me)) + slash + 'Notifications', title: 'Inbox', sub: unread + ' unread · ' + items.length + (items.length === 1 ? ' notification' : ' notifications') + ' · comments and changes from others on your issues', right }) +
      '<div class="inbox"><div class="ibx-list" role="list" data-sk="inbox">';
    if (!items.length) h += '<div class="empty">' + ic('inbox', 32) + '<b>You\'re all caught up</b><span>Comments and changes from others on your issues show up here.</span></div>';
    items.forEach((x) => {
      const i = x.issue, ev = x.ev, m = member(ev.actor);
      const what = ev.type === 'comment' ? 'commented: ' + esc(ev.text.slice(0, 90)) : ev.type === 'create' ? 'created and assigned this to you' : stripTags(describe(ev));
      h += '<div role="listitem"><a class="ibx-item' + (x.unread ? ' unread' : '') + (sel === i ? ' on' : '') + '" href="#/inbox/' + ident(i) + '">' + (x.unread ? '<span class="udot" aria-label="Unread"></span>' : '') +
        '<span>' + avatar(m, 28) + '</span><span class="ibx-main"><span class="ibx-title"><span class="ident">' + ident(i) + '</span><span>' + esc(i.title) + '</span></span>' +
        '<span class="ibx-sub">' + statusIcon(i.status, 12) + '<span>' + esc(firstName(ev.actor)) + ' ' + what + '</span></span></span><span class="ibx-time" title="' + esc(fullTime(ev.at)) + '">' + ago(ev.at) + '</span></a></div>';
    });
    h += '</div><div class="ibx-pane" data-sk="inbox-pane:' + (sel ? sel.id : '') + '">';
    if (sel) {
      h += '<div class="pane-head"><span class="eyebrow">' + ident(sel) + slash + esc(team(sel.team).name) + '</span><div class="grow"></div>' +
        '<button type="button" class="btn sm" data-act="inbox-clear" data-id="' + sel.id + '">' + ic('check') + 'Done</button>' +
        '<a class="btn sm" href="#/issue/' + ident(sel) + '">' + ic('open') + 'Open issue</a></div>' + issueBody(sel, true);
    } else h += '<div class="empty">' + ic('inbox', 32) + '<b>' + (items.length ? 'Select a notification' : 'No notifications') + '</b><span>Use <kbd>J</kbd> and <kbd>K</kbd> to move through them.</span></div>';
    return h + '</div></div>';
  }

  function projectProgress(p) {
    const its = db.issues.filter((i) => i.project === p.id && i.status !== 'canceled');
    const done = its.filter((i) => i.status === 'done').length;
    return { total: its.length, done, pct: its.length ? Math.round(done * 100 / its.length) : 0 };
  }
  function viewProjects(r) {
    const t = r.team ? team(r.team) : null;
    const list = db.projects.filter((p) => !t || p.team === t.id).sort((a, b) => {
      const order = ['started', 'planned', 'paused', 'backlog', 'completed', 'canceled'];
      return order.indexOf(a.status) - order.indexOf(b.status) || cmp(a.target || '9', b.target || '9');
    });
    const active = list.filter((p) => p.status === 'started').length;
    let h = topline() + head({ eyebrow: t ? teamIcon(t, 16) + esc(t.key) + slash + 'Team' : 'Workspace', title: t ? t.name + ' projects' : 'Projects', sub: list.length + (list.length === 1 ? ' project' : ' projects') + ' · ' + active + ' in progress',
      right: '<button type="button" class="btn" data-act="new-project"' + (t ? ' data-team="' + t.id + '"' : '') + '>' + ic('plus') + 'New project</button>' });
    if (!list.length) return h + '<div class="empty">' + ic('project', 32) + '<b>No projects yet</b><span>Projects group issues toward a goal with a target date.</span><button type="button" class="btn primary" data-act="new-project">' + ic('plus') + 'New project</button></div>';
    h += '<div class="table-card"><div class="table-head"><span>Project</span><span>Lead</span><span>Target</span><span>Status</span><span>Progress</span></div>';
    list.forEach((p) => {
      const pr = projectProgress(p), st = PROJECT_STATUSES.find((s) => s[0] === p.status) || PROJECT_STATUSES[1], pt = IDX.team.get(p.team);
      const late = p.target && p.status !== 'completed' && p.status !== 'canceled' && p.target < today();
      h += '<a class="prow" href="#/project/' + p.id + '"><span class="pname"><span class="ptile" style="--pc:' + esc(p.color) + '">' + projIcon(p, 18) + '</span><span class="ptext"><b>' + esc(p.name) + '</b><small>' + esc(pt ? pt.name : '') + '</small></span></span>' +
        '<span class="cell lead">' + avatar(member(p.lead), 24) + '<span>' + esc(p.lead ? memberName(p.lead) : 'No lead') + '</span></span>' +
        '<span class="cell target mono-s' + (late ? ' bad' : '') + '">' + (p.target ? esc(fmtDay(p.target)) : '—') + '</span>' +
        '<span class="cell"><span class="pstatus">' + projStatusIcon(p.status) + esc(st[1]) + '</span></span>' +
        '<span class="cell prog"><span class="bar"><i style="width:' + pr.pct + '%"></i></span><span class="mono-s">' + pr.pct + '%</span></span></a>';
    });
    return h + '</div>';
  }
  function viewProject(r) {
    const p = IDX.project.get(r.id), pr = projectProgress(p), st = PROJECT_STATUSES.find((s) => s[0] === p.status) || PROJECT_STATUSES[1], pt = IDX.team.get(p.team);
    const right = '<button type="button" class="round" data-act="project-menu" data-pid="' + p.id + '" aria-label="Project actions" title="Project actions">' + ic('more') + '</button>';
    const extra = '<div class="phead-card"><label class="sr" for="pdesc">Description</label><textarea id="pdesc" rows="1" data-auto data-keep="pdesc:' + p.id + '" data-pfield="description" data-id="' + p.id + '" placeholder="Add a short summary…">' + esc(p.description || '') + '</textarea>' +
      '<div class="phead-props">' +
      '<button type="button" class="pill" data-pick="pstatus" data-pid="' + p.id + '">' + projStatusIcon(p.status) + esc(st[1]) + '</button>' +
      '<button type="button" class="pill" data-pick="plead" data-pid="' + p.id + '">' + avatar(member(p.lead), 20) + (p.lead ? esc(memberName(p.lead)) : '<span class="muted">Lead</span>') + '</button>' +
      '<button type="button" class="pill" data-pick="ptarget" data-pid="' + p.id + '">' + ic('cal') + (p.target ? 'Target ' + fmtDay(p.target) : '<span class="muted">Target date</span>') + '</button>' +
      '<button type="button" class="pill" data-pick="pteam" data-pid="' + p.id + '">' + (pt ? teamIcon(pt, 18) + esc(pt.name) : '<span class="muted">Team</span>') + '</button></div>' +
      '<div class="kpis">' + kpi('Issues', pr.total) + kpi('Done', pr.done) + kpi('Progress', pr.pct + '%', true) + '</div>' +
      '<div class="pbar"><span class="bar big"><i style="width:' + pr.pct + '%"></i></span></div></div>';
    return listPage(ui.ctx, { eyebrow: crumb('#/projects', 'Projects') + slash + esc(pt ? pt.key : ''), title: p.name, sub: esc(st[1]) + ' · ' + pr.done + ' of ' + pr.total + ' issues done' + (p.target ? ' · target ' + esc(fmtDay(p.target)) : ''), right }, '', extra);
  }
  function kpi(label, value, inv) { return '<div class="kpi' + (inv ? ' inv' : '') + '"><span class="mono-l">' + esc(label) + '</span><b>' + esc(value) + '</b></div>'; }

  function cycleStats(t, n) {
    const its = db.issues.filter((i) => i.team === t.id && i.cycle === n && i.status !== 'canceled');
    const done = its.filter((i) => i.status === 'done').length, started = its.filter((i) => i.status === 'progress' || i.status === 'review').length;
    return { its, total: its.length, done, started, pct: its.length ? Math.round(done * 100 / its.length) : 0 };
  }
  function viewCycles(r) {
    const t = team(r.team), cur = currentCycle(t), cc = cycleOf(t, cur);
    const row = (n) => {
      const c = cycleOf(t, n), s = cycleStats(t, n);
      const tag = n === cur ? 'Current' : n > cur ? 'Upcoming' : 'Completed';
      return '<a class="crow" href="#/team/' + t.key + '/cycle/' + n + '"><span class="cname"><span class="ctile' + (n === cur ? ' on' : '') + '">' + n + '</span><span class="ptext"><b>Cycle ' + n + '</b><small>' + esc(cycleRange(c)) + '</small></span></span>' +
        '<span class="tagpill' + (n === cur ? ' cur' : '') + '">' + tag + '</span>' +
        '<span class="cell prog"><span class="bar"><i style="width:' + s.pct + '%"></i></span><span class="mono-s">' + s.pct + '%</span></span><span class="mono-s right">' + s.done + ' / ' + s.total + ' done</span></a>';
    };
    const past = [];
    for (let n = cur - 1; n >= Math.max(1, cur - 5); n--) past.push(n);
    return topline() + head({ eyebrow: teamIcon(t, 16) + crumb('#/team/' + t.key + '/issues/all', t.name) + slash + 'Cycles', title: 'Cycles', sub: t.cycleDays / 7 + '-week cycles · cycle ' + cur + ' ends ' + esc(fmtDay(cc.end)) }) +
      '<h2 class="sec-l">Current</h2><div class="table-card">' + row(cur) + '</div>' +
      '<h2 class="sec-l">Upcoming</h2><div class="table-card">' + row(cur + 1) + row(cur + 2) + '</div>' +
      (past.length ? '<h2 class="sec-l">Past</h2><div class="table-card">' + past.map(row).join('') + '</div>' : '');
  }
  function firstStarted(i) { const ev = i.activity.find((a) => a.type === 'change' && a.field === 'status' && (a.to === 'progress' || a.to === 'review' || a.to === 'done')); return ev ? ev.at : null; }
  function burnup(t, n) {
    const c = cycleOf(t, n), s = cycleStats(t, n), days = t.cycleDays, W = 600, H = 170, pad = 26;
    const last = Math.min(days - 1, daysBetween(c.start, today()));
    const series = { scope: [], started: [], done: [] };
    for (let d = 0; d <= Math.max(0, last); d++) {
      const end = parseYmd(addDays(c.start, d)).getTime() + DAY;
      series.scope.push(s.its.filter((i) => new Date(i.createdAt).getTime() < end).length);
      series.started.push(s.its.filter((i) => { const a = firstStarted(i); return a && new Date(a).getTime() < end; }).length);
      series.done.push(s.its.filter((i) => i.completedAt && new Date(i.completedAt).getTime() < end).length);
    }
    const max = Math.max(1, s.total, ...series.scope);
    const x = (d) => pad + d * (W - pad - 8) / (days - 1), y = (v) => H - 20 - v * (H - 34) / max;
    const line = (arr) => arr.map((v, d) => (d ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    let svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Cycle burn-up: ' + s.done + ' of ' + s.total + ' issues done">';
    [0.5, 1].forEach((f) => { svg += '<line class="grid" x1="' + pad + '" x2="' + (W - 8) + '" y1="' + y(max * f).toFixed(1) + '" y2="' + y(max * f).toFixed(1) + '"/>'; });
    svg += '<line class="axis" x1="' + pad + '" y1="' + (H - 20) + '" x2="' + (W - 8) + '" y2="' + (H - 20) + '"/>' +
      '<text x="' + pad + '" y="' + (H - 4) + '">' + esc(fmtDay(c.start)) + '</text><text x="' + (W - 8) + '" y="' + (H - 4) + '" text-anchor="end">' + esc(fmtDay(c.end)) + '</text>' +
      '<text x="' + (pad - 6) + '" y="' + (y(max) + 4) + '" text-anchor="end">' + max + '</text>';
    if (last >= 0) {
      svg += '<path class="donefill" d="' + line(series.done) + ' L' + x(series.done.length - 1).toFixed(1) + ' ' + (H - 20) + ' L' + x(0) + ' ' + (H - 20) + ' Z"/>' +
        '<path class="scope" d="' + line(series.scope) + '"/><path class="started" d="' + line(series.started) + '"/><path class="done" d="' + line(series.done) + '"/>';
      if (last < days - 1) svg += '<line class="today" x1="' + x(last) + '" y1="8" x2="' + x(last) + '" y2="' + (H - 20) + '"/>';
    }
    return svg + '</svg><div class="legend"><span><i class="l-scope"></i>Scope</span><span><i class="l-started"></i>Started</span><span><i class="l-done"></i>Completed</span></div>';
  }
  function breakdown(s) {
    let rows = [];
    if (ui.brk === 'assignee') {
      const ids = uniq(s.its.map((i) => i.assignee || ''));
      rows = ids.map((id) => ({ icon: avatar(member(id), 22), name: id ? memberName(id) : 'No assignee', its: s.its.filter((i) => (i.assignee || '') === id) }));
    } else if (ui.brk === 'label') {
      rows = db.labels.map((l) => ({ icon: '<span class="dot lg" style="background:' + esc(l.color) + '"></span>', name: l.name, its: s.its.filter((i) => i.labels.includes(l.id)) })).filter((x) => x.its.length);
    } else {
      rows = [1, 2, 3, 4, 0].map((p) => ({ icon: prioIcon(p), name: PRIO_NAME[p], its: s.its.filter((i) => (i.priority || 0) === p) })).filter((x) => x.its.length);
    }
    rows.sort((a, b) => b.its.length - a.its.length);
    const segBtn = (k, l) => '<button type="button" data-act="brk" data-v="' + k + '" class="seg-i' + (ui.brk === k ? ' on' : '') + '" aria-pressed="' + (ui.brk === k) + '">' + l + '</button>';
    let h = '<div class="seg" role="group" aria-label="Breakdown">' + segBtn('assignee', 'Assignees') + segBtn('label', 'Labels') + segBtn('priority', 'Priority') + '</div><div class="brk">';
    if (!rows.length) h += '<p class="muted">No issues in this cycle yet.</p>';
    rows.forEach((x, k) => {
      const d = x.its.filter((i) => i.status === 'done').length, pct = Math.round(d * 100 / x.its.length);
      h += '<div class="brk-row"><span class="mono-s idx">' + String(k + 1).padStart(2, '0') + '</span>' + x.icon + '<span class="name">' + esc(x.name) + '</span><span class="mono-s num">' + d + ' / ' + x.its.length + '</span><span class="bar"><i style="width:' + pct + '%"></i></span></div>';
    });
    return h + '</div>';
  }
  function viewCycle(r) {
    const t = team(r.team), c = cycleOf(t, r.n), s = cycleStats(t, r.n), cur = currentCycle(t);
    const left = daysBetween(today(), c.end);
    const when = r.n === cur ? (left === 0 ? 'ends today' : left + (left === 1 ? ' day left' : ' days left')) : r.n > cur ? 'starts ' + fmtDay(c.start) : 'completed';
    const right = round('cycle-step', 'up', 'Previous cycle', ' data-v="-1"' + (r.n > 1 ? '' : ' disabled')) + round('cycle-step', 'down', 'Next cycle', ' data-v="1"');
    const extra = '<div class="cyc-grid"><div class="cyc-card"><div class="kpis">' + kpi('Scope', s.total) + kpi('Started', s.started) + kpi('Completed', s.done) + kpi('Progress', s.pct + '%', true) + '</div>' + burnup(t, r.n) + '</div>' +
      '<div class="cyc-card">' + breakdown(s) + '</div></div>';
    return listPage(ui.ctx, { eyebrow: teamIcon(t, 16) + crumb('#/team/' + t.key + '/issues/all', t.name) + slash + crumb('#/team/' + t.key + '/cycles', 'Cycles'), title: 'Cycle ' + r.n, sub: esc(cycleRange(c)) + ' · ' + when, right }, '', extra);
  }

  function viewSettings() {
    const counts = (fn) => db.issues.filter(fn).length;
    let h = topline() + head({ eyebrow: esc(db.workspace.name) + slash + 'Workspace', title: 'Settings', sub: 'Workspace, people, labels and teams · changes are saved as you type' }) + '<div class="settings">';
    h += '<section class="scard"><h2 class="mono-l">Workspace</h2><div class="srow"><label for="wsName" class="slabel">Name</label><input id="wsName" class="tin" data-set="ws-name" data-keep="ws-name" value="' + esc(db.workspace.name) + '"></div></section>';
    h += '<section class="scard"><h2 class="mono-l">Members</h2><p class="lead">Who can be assigned. “Acting as” in the sidebar decides who you are in this browser.</p>';
    db.members.forEach((m) => {
      const n = counts((i) => i.assignee === m.id && !isClosed(i));
      h += '<div class="srow">' + avatar(m, 32) + '<label class="sr" for="mn-' + m.id + '">Name</label><input id="mn-' + m.id + '" class="tin bare" data-set="member-name" data-id="' + m.id + '" data-keep="mn:' + m.id + '" value="' + esc(m.name) + '">' +
        '<label class="sr" for="mc-' + m.id + '">Colour</label><input id="mc-' + m.id + '" type="color" class="swatch" data-set="member-color" data-id="' + m.id + '" value="' + esc(m.color) + '">' +
        '<span class="mono-s">' + (m.id === db.me ? 'you · ' : '') + n + ' open</span>' +
        '<button type="button" class="round sm" data-act="member-del" data-id="' + m.id + '" aria-label="Remove ' + esc(m.name) + '" title="' + (m.id === db.me ? 'Switch to someone else first' : 'Remove') + '"' + (m.id === db.me ? ' disabled' : '') + '>' + ic('trash') + '</button></div>';
    });
    h += '<div class="srow add"><label class="sr" for="newMember">New member name</label><input id="newMember" class="tin" placeholder="Full name" data-keep="new-member"><button type="button" class="btn" data-act="member-add">' + ic('plus') + 'Add member</button></div></section>';
    h += '<section class="scard"><h2 class="mono-l">Labels</h2>';
    db.labels.forEach((l) => {
      h += '<div class="srow"><label class="sr" for="lc-' + l.id + '">Colour</label><input id="lc-' + l.id + '" type="color" class="swatch" data-set="label-color" data-id="' + l.id + '" value="' + esc(l.color) + '">' +
        '<label class="sr" for="ln-' + l.id + '">Name</label><input id="ln-' + l.id + '" class="tin bare" data-set="label-name" data-id="' + l.id + '" data-keep="ln:' + l.id + '" value="' + esc(l.name) + '">' +
        '<span class="mono-s">' + counts((i) => i.labels.includes(l.id)) + ' issues</span><button type="button" class="round sm" data-act="label-del" data-id="' + l.id + '" aria-label="Delete label ' + esc(l.name) + '" title="Delete">' + ic('trash') + '</button></div>';
    });
    h += '<div class="srow add"><label class="sr" for="newLabel">New label</label><input id="newLabel" class="tin" placeholder="Label name" data-keep="new-label"><button type="button" class="btn" data-act="label-add">' + ic('plus') + 'Add label</button></div></section>';
    h += '<section class="scard"><h2 class="mono-l">Teams</h2><p class="lead">Each team has its own issue prefix and two-week cycles.</p>';
    db.teams.forEach((t) => {
      const n = counts((i) => i.team === t.id);
      h += '<div class="srow">' + teamIcon(t, 28) + '<span class="mono-s key">' + esc(t.key) + '</span><label class="sr" for="tn-' + t.id + '">Team name</label><input id="tn-' + t.id + '" class="tin bare" data-set="team-name" data-id="' + t.id + '" data-keep="tn:' + t.id + '" value="' + esc(t.name) + '">' +
        '<label class="sr" for="tc-' + t.id + '">Colour</label><input id="tc-' + t.id + '" type="color" class="swatch" data-set="team-color" data-id="' + t.id + '" value="' + esc(t.color) + '">' +
        '<span class="mono-s">' + n + ' issues</span><button type="button" class="round sm" data-act="team-del" data-id="' + t.id + '" aria-label="Delete team ' + esc(t.name) + '" title="' + (n || db.teams.length < 2 ? 'Only an empty team can be deleted, and one team must remain' : 'Delete') + '"' + (n || db.teams.length < 2 ? ' disabled' : '') + '>' + ic('trash') + '</button></div>';
    });
    h += '<div class="srow add"><label class="sr" for="newTeam">New team name</label><input id="newTeam" class="tin" placeholder="Team name"><label class="sr" for="newTeamKey">Prefix</label><input id="newTeamKey" class="tin key-in" placeholder="KEY" maxlength="5"><button type="button" class="btn" data-act="team-add">' + ic('plus') + 'Add team</button></div></section>';
    h += '<section class="scard"><h2 class="mono-l">Data</h2><p class="lead">This workspace lives in this browser. Sign in to keep a private copy in the cloud and use it on another device.</p><div id="syncSlot" class="sync-slot"></div>' +
      '<div class="btn-row"><button type="button" class="btn" data-act="export">' + ic('download') + 'Export JSON</button>' +
      '<label class="btn">' + ic('upload') + 'Import JSON<input type="file" accept="application/json,.json" data-act-file="import" class="sr"></label>' +
      '<button type="button" class="btn" data-act="reset-demo">' + ic('reset') + 'Reset demo data</button><button type="button" class="btn danger" data-act="empty">' + ic('trash') + 'Start empty</button></div></section>';
    h += '<section class="scard"><h2 class="mono-l">Keyboard</h2><p class="lead">Press <kbd>?</kbd> anywhere to see every shortcut, or <kbd>⌘</kbd> <kbd>K</kbd> for the command menu.</p><button type="button" class="btn" data-act="shortcuts">' + ic('key') + 'Show shortcuts</button></section>';
    return h + '</div>';
  }

  function renderBulk() {
    let el = $('bulk');
    const n = ui.selected.size;
    if (!n) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'bulk'; el.className = 'bulk'; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', 'Selected issues'); document.body.appendChild(el); }
    el.innerHTML = '<span class="n">' + n + ' selected</span>' +
      '<button type="button" class="bb" data-pick="status" data-bulk="1">' + statusIcon('progress') + 'Status</button>' +
      '<button type="button" class="bb" data-pick="priority" data-bulk="1">' + prioIcon(2) + 'Priority</button>' +
      '<button type="button" class="bb" data-pick="assignee" data-bulk="1">' + ic('my') + 'Assignee</button>' +
      '<button type="button" class="bb" data-pick="labels" data-bulk="1">' + ic('tag') + 'Labels</button>' +
      '<button type="button" class="bb" data-pick="project" data-bulk="1">' + ic('project') + 'Project</button>' +
      '<button type="button" class="bb" data-pick="cycle" data-bulk="1">' + ic('cycle') + 'Cycle</button>' +
      '<button type="button" class="bb" data-pick="due" data-bulk="1">' + ic('cal') + 'Due</button>' +
      '<button type="button" class="bb danger" data-act="delete" data-bulk="1">' + ic('trash') + 'Delete</button>' +
      '<button type="button" class="bb x" data-act="sel-clear" aria-label="Clear selection (Esc)" title="Clear selection  Esc">' + ic('x') + '</button>';
  }

  // ── toasts & dialogs ─────────────────────────────────────────────────────
  function toast(msg, action) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button" class="btn sm">' + esc(action.label) + '</button>' : '');
    if (action) el.querySelector('button').onclick = () => { el.remove(); action.run(); };
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), action ? 6000 : 3200);
  }
  function confirmBox(title, body, okLabel, danger) {
    return new Promise((resolve) => {
      closeLayer(true);
      const ret = document.activeElement;
      ui.layer = { type: 'dialog', returnFocus: ret, resolve };
      $('layers').innerHTML = '<div class="layer-scrim dim" data-layer-close></div><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlgT" aria-describedby="dlgB"><h2 id="dlgT">' + esc(title) + '</h2><p id="dlgB">' + esc(body) + '</p>' +
        '<div class="acts"><button type="button" class="btn" data-dlg="0">Cancel</button><button type="button" class="btn ' + (danger ? 'primary" style="background:var(--danger);border-color:var(--danger)' : 'primary') + '" data-dlg="1">' + esc(okLabel) + '</button></div></div>';
      $('layers').querySelector('[data-dlg="1"]').focus();
    });
  }
  function promptBox(title, label, value, okLabel) {
    return new Promise((resolve) => {
      closeLayer(true);
      ui.layer = { type: 'dialog', returnFocus: document.activeElement, resolve: () => resolve(null), prompt: (v) => resolve(v) };
      $('layers').innerHTML = '<div class="layer-scrim dim" data-layer-close></div><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h2 id="dlgT">' + esc(title) + '</h2>' +
        '<label class="flabel" for="dlgIn">' + esc(label) + '</label><input id="dlgIn" class="tin wide" value="' + esc(value || '') + '">' +
        '<div class="acts"><button type="button" class="btn" data-dlg="0">Cancel</button><button type="button" class="btn primary" data-dlg="2">' + esc(okLabel) + '</button></div></div>';
      const inp = $('dlgIn'); inp.focus(); inp.select();
    });
  }
  function shortcuts() {
    closeLayer(true);
    ui.layer = { type: 'dialog', returnFocus: document.activeElement };
    const k = (...ks) => ks.map((x) => '<kbd>' + x + '</kbd>').join('');
    const row = (label, keys) => '<div><span>' + label + '</span><span>' + keys + '</span></div>';
    $('layers').innerHTML = '<div class="layer-scrim dim" data-layer-close></div><div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="kT"><h2 id="kT">Keyboard shortcuts</h2><div class="keys">' +
      '<h4>General</h4>' + row('Command menu', k('⌘', 'K')) + row('Create issue', k('C')) + row('Search in view', k('/')) + row('Undo', k('⌘', 'Z')) + row('Shortcuts', k('?')) + row('Back / close', k('Esc')) +
      '<h4>Navigation</h4>' + row('Inbox', k('G', 'I')) + row('My issues', k('G', 'M')) + row('Team issues', k('G', 'T')) + row('Cycles', k('G', 'C')) + row('Projects', k('G', 'P')) + row('Settings', k('G', 'S')) + row('Next / previous', k('J') + ' ' + k('K')) + row('Open issue', k('↵')) +
      '<h4>Issues (focused, selected or open)</h4>' + row('Status', k('S')) + row('Priority', k('P')) + row('Assignee', k('A')) + row('Assign to me', k('I')) + row('Labels', k('L')) + row('Due date', k('D')) + row('Estimate', k('E')) + row('Select', k('X')) + row('Delete', k('⌘', '⌫')) + row('Send comment / create', k('⌘', '↵')) +
      '</div><div class="acts"><button type="button" class="btn" data-layer-close>Close</button></div></div>';
    $('layers').querySelector('.dialog .btn').focus();
  }

  // ── layers: menus (pickers, palette, filter), forms ──────────────────────
  function closeLayer(silent) {
    const l = ui.layer;
    if (!l) return;
    if (l.parent) {
      const s = $('subLayer');
      if (s) s.remove();
      ui.layer = l.parent;
      if (!silent && l.returnFocus && document.contains(l.returnFocus)) l.returnFocus.focus({ preventScroll: true });
      return;
    }
    ui.layer = null;
    $('layers').innerHTML = '';
    if (l.resolve) l.resolve(false);
    if (l.onClose) l.onClose();
    if (!silent && l.returnFocus && document.contains(l.returnFocus)) l.returnFocus.focus({ preventScroll: true });
  }
  function position(box, anchor) {
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const w = box.offsetWidth, h = box.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x, y;
    if (!r || (!r.width && !r.height)) { x = (vw - w) / 2; y = vh * 0.18; }
    else { x = Math.min(r.left, vw - w - 8); y = r.bottom + 4; if (y + h > vh - 8) y = Math.max(8, r.top - h - 4); }
    box.style.left = Math.max(8, x) + 'px';
    box.style.top = Math.max(8, y) + 'px';
  }
  // A page: { placeholder, items(q) → [{label, icon, hint, kbds, section, checked, keywords, run, page, keep, always, danger}], multi, numbers, footer, ctx }
  function openMenu(page, opt) {
    // over: a picker opened from the New issue dialog stacks on top of it instead of replacing it
    const parent = opt && opt.over && ui.layer && ui.layer.type === 'create' ? ui.layer : null;
    const ret = parent ? document.activeElement : ui.layer && ui.layer.returnFocus || document.activeElement;
    if (!parent) closeLayer(true);
    let host = $('layers');
    if (parent) { host = document.createElement('div'); host.id = 'subLayer'; $('layers').appendChild(host); }
    const palette = !!(opt && opt.palette);
    ui.layer = { type: 'menu', palette, stack: [page], q: '', active: 0, returnFocus: ret, anchor: opt && opt.anchor, parent };
    host.innerHTML = '<div class="layer-scrim' + (palette ? ' dim' : '') + '" data-layer-close></div><div class="' + (palette ? 'palette' : 'pop') + '" role="dialog" aria-modal="true" aria-label="' + esc(page.placeholder) + '" id="menuBox"></div>';
    drawMenuFrame();
    if (!palette) position($('menuBox'), opt && opt.anchor);
  }
  function topPage() { return ui.layer.stack[ui.layer.stack.length - 1]; }
  function drawMenuFrame() {
    const p = topPage(), box = $('menuBox');
    box.innerHTML = (p.ctx ? '<div class="ctx">' + p.ctx + '</div>' : '') +
      '<div class="pop-in">' + (ui.layer.palette ? ic('search') : '') + '<input id="menuIn" type="text" role="combobox" aria-expanded="true" aria-controls="menuList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="' + esc(p.placeholder) + '" aria-label="' + esc(p.placeholder) + '">' +
      (ui.layer.stack.length > 1 ? '<kbd title="Back">⌫</kbd>' : '') + '</div><div class="pop-list" id="menuList" role="listbox"' + (p.multi ? ' aria-multiselectable="true"' : '') + '></div>' + (p.footer ? p.footer() : '');
    ui.layer.q = ''; ui.layer.active = 0;
    drawMenu();
    $('menuIn').focus();
  }
  function menuItems() {
    const p = topPage(), q = ui.layer.q.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
    const all = typeof p.items === 'function' ? p.items(q) : p.items;
    return all.filter((it) => it.always || !words.length || words.every((w) => (it.label + ' ' + (it.keywords || '') + ' ' + (it.section || '')).toLowerCase().includes(w)));
  }
  function drawMenu() {
    const list = $('menuList');
    if (!list) return;
    const items = menuItems(), p = topPage();
    ui.layer.items = items;
    if (ui.layer.active >= items.length) ui.layer.active = Math.max(0, items.length - 1);
    let h = '', sec = null;
    items.forEach((it, k) => {
      if (it.section && it.section !== sec) { sec = it.section; h += '<div class="opt-sec" role="presentation">' + esc(sec) + '</div>'; }
      const on = k === ui.layer.active;
      h += '<div class="opt' + (on ? ' on' : '') + (it.danger ? ' danger' : '') + '" role="option" id="opt-' + k + '" data-k="' + k + '" aria-selected="' + (p.multi ? !!it.checked : on) + '">' +
        (p.multi ? '<input type="checkbox" tabindex="-1" aria-hidden="true"' + (it.checked ? ' checked' : '') + '>' : '') + (it.icon || '') +
        '<span class="lbl">' + esc(it.label) + '</span>' + (it.hint ? '<span class="hint">' + esc(it.hint) + '</span>' : '') +
        (!p.multi && it.checked ? ic('check', 14, 'chk') : '') + (it.kbds ? '<span class="kbds">' + it.kbds.map((x) => '<kbd>' + esc(x) + '</kbd>').join('') + '</span>' : '') + '</div>';
    });
    list.innerHTML = h || '<div class="pop-empty">No results</div>';
    const inp = $('menuIn');
    if (inp) inp.setAttribute('aria-activedescendant', items.length ? 'opt-' + ui.layer.active : '');
    const act = list.querySelector('.opt.on');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }
  function chooseMenu(k) {
    const it = ui.layer.items && ui.layer.items[k];
    if (!it) return;
    const p = topPage();
    if (it.page) { ui.layer.stack.push(it.page()); drawMenuFrame(); return; }
    if (p.multi && !it.close) { it.run(); ui.layer.active = k; drawMenu(); return; }
    closeLayer();
    it.run();
  }
  function menuKey(e) {
    const L = ui.layer, p = topPage();
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); L.active = Math.min(L.items.length - 1, L.active + 1); drawMenu(); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); L.active = Math.max(0, L.active - 1); drawMenu(); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseMenu(L.active); }
    else if (e.key === 'Escape') { e.preventDefault(); if (L.stack.length > 1) { L.stack.pop(); drawMenuFrame(); } else closeLayer(); }
    else if (e.key === 'Backspace' && !e.target.value && L.stack.length > 1) { e.preventDefault(); L.stack.pop(); drawMenuFrame(); }
    else if (p.numbers && !e.target.value && /^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const n = Number(e.key), k = L.items.findIndex((it) => it.num === n);
      if (k >= 0) { e.preventDefault(); chooseMenu(k); }
    }
  }

  // targets: issue ids or the create-issue draft
  function adapter(ids) {
    if (ids === 'draft') {
      const d = ui.draft;
      return {
        list: [d], draft: true, team: d.team,
        set: (f, v) => { if (f === 'team' && v !== d.team) { d.team = v; d.cycle = null; const p = IDX.project.get(d.project); if (p && p.team !== v) d.project = null; } else d[f] = v; drawCreateProps(); },
        toggleLabel: (lid, on) => { d.labels = on ? uniq(d.labels.concat(lid)) : d.labels.filter((x) => x !== lid); drawCreateProps(); }
      };
    }
    const list = ids.map(issueById).filter(Boolean);
    const many = list.length > 1;
    return {
      list, team: list[0] ? list[0].team : db.teams[0].id,
      set: (f, v, label) => mutate(many ? 'Updated ' + list.length + ' issues' : (label || null), () => list.map((i) => setField(i, f, v)).some(Boolean)),
      toggleLabel: (lid, on) => mutate(many ? 'Updated labels on ' + list.length + ' issues' : null, () => list.map((i) => toggleLabel(i, lid, on)).some(Boolean))
    };
  }
  const allEq = (list, f, v) => list.length && list.every((i) => same(i[f], v));
  function fieldPage(field, A) {
    const L = A.list;
    const num = (arr) => arr.map((it, k) => Object.assign(it, { num: k + 1 < 10 ? k + 1 : null, hint: it.hint || (k < 9 ? String(k + 1) : '') }));
    switch (field) {
      case 'status': return { placeholder: 'Change status…', numbers: true, items: num(STATUSES.map((s) => ({ label: s.name, icon: statusIcon(s.id), checked: allEq(L, 'status', s.id), run: () => A.set('status', s.id) }))) };
      case 'priority': return { placeholder: 'Set priority to…', numbers: true, items: PRIO_MENU.map((p, k) => ({ label: PRIO_NAME[p], icon: prioIcon(p), checked: allEq(L, 'priority', p), num: k, hint: String(k), run: () => A.set('priority', p) })) };
      case 'assignee': {
        const ms = db.members.slice().sort((a, b) => (a.id === db.me ? -1 : b.id === db.me ? 1 : a.name.localeCompare(b.name)));
        return { placeholder: 'Assign to…', numbers: true, items: num([{ label: 'No assignee', icon: avatar(null, 18), checked: allEq(L, 'assignee', null), run: () => A.set('assignee', null) }]
          .concat(ms.map((m) => ({ label: m.name + (m.id === db.me ? ' (you)' : ''), icon: avatar(m, 18), checked: allEq(L, 'assignee', m.id), run: () => A.set('assignee', m.id) })))) };
      }
      case 'labels': return {
        placeholder: 'Change labels…', multi: true,
        items: (q) => {
          const out = db.labels.map((l) => ({ label: l.name, icon: '<span class="dot" style="width:9px;height:9px;border-radius:50%;background:' + esc(l.color) + '"></span>', checked: L.length && L.every((i) => i.labels.includes(l.id)), run() { A.toggleLabel(l.id, !this.checked); this.checked = !this.checked; } }));
          const name = q.trim();
          if (name && !db.labels.some((l) => l.name.toLowerCase() === name)) {
            out.push({ label: 'Create label “' + name + '”', icon: ic('plus', 14), always: true, run() {
              const raw = $('menuIn').value.trim(), l = { id: uid('l'), name: raw, color: COLORS[db.labels.length % COLORS.length] };
              db.labels.push(l); IDX.label.set(l.id, l); A.toggleLabel(l.id, true); $('menuIn').value = ''; ui.layer.q = '';
            } });
          }
          return out;
        }
      };
      case 'project': {
        const t = A.team, ps = db.projects.slice().sort((a, b) => (a.team === t ? 0 : 1) - (b.team === t ? 0 : 1) || (a.status === 'completed' || a.status === 'canceled' ? 1 : 0) - (b.status === 'completed' || b.status === 'canceled' ? 1 : 0));
        return { placeholder: 'Move to project…', items: [{ label: 'No project', icon: projIcon(null), checked: allEq(L, 'project', null), run: () => A.set('project', null) }]
          .concat(ps.map((p) => ({ label: p.name, icon: projIcon(p), hint: (IDX.team.get(p.team) || {}).key || '', checked: allEq(L, 'project', p.id), run: () => A.set('project', p.id) }))) };
      }
      case 'cycle': {
        const t = team(A.team), cur = currentCycle(t), ns = [cur, cur + 1, cur + 2];
        L.forEach((i) => { if (i.cycle != null && !ns.includes(i.cycle)) ns.push(i.cycle); });
        return { placeholder: 'Add to cycle…', items: [{ label: 'No cycle', icon: ic('cycle', 14), checked: allEq(L, 'cycle', null), run: () => A.set('cycle', null) }]
          .concat(ns.sort((a, b) => a - b).map((n) => ({ label: 'Cycle ' + n + (n === cur ? ' (current)' : n === cur + 1 ? ' (next)' : ''), hint: cycleRange(cycleOf(t, n)), icon: ic('cycle', 14), checked: allEq(L, 'cycle', n), run: () => A.set('cycle', n) }))) };
      }
      case 'due': {
        const t0 = today(), dow = (new Date().getDay() + 6) % 7;
        const opts = [['Today', t0], ['Tomorrow', addDays(t0, 1)], ['End of this week', addDays(t0, Math.max(0, 4 - dow))], ['Next week', addDays(t0, 7 - dow)], ['In two weeks', addDays(t0, 14)], ['In a month', addDays(t0, 30)]];
        const items = opts.map((o) => ({ label: o[0], hint: fmtDay(o[1]), icon: ic('cal', 14), checked: allEq(L, 'due', o[1]), run: () => A.set('due', o[1]) }));
        if (L.some((i) => i.due)) items.push({ label: 'Remove due date', icon: ic('x', 14), run: () => A.set('due', null) });
        return { placeholder: 'Set due date…', items, footer: () => '<div class="pop-foot"><label class="sr" for="dueIn">Pick a date</label><input id="dueIn" type="date" class="tin" value="' + esc(L.length === 1 && L[0].due || '') + '"></div>', onDate: (v) => { if (v) { closeLayer(); A.set('due', v); } } };
      }
      case 'estimate': return { placeholder: 'Set estimate…', numbers: true, items: [{ label: 'No estimate', icon: ic('est', 14), checked: allEq(L, 'estimate', null), num: 0, hint: '0', run: () => A.set('estimate', null) }]
        .concat(ESTIMATES.map((n, k) => ({ label: n + (n === 1 ? ' point' : ' points'), icon: ic('est', 14), checked: allEq(L, 'estimate', n), num: k + 1, hint: String(k + 1), run: () => A.set('estimate', n) }))) };
      case 'team': return { placeholder: 'Move to team…', items: db.teams.map((t) => ({ label: t.name, hint: t.key, icon: teamIcon(t, 16), checked: allEq(L, 'team', t.id), run: () => A.set('team', t.id, A.draft ? null : 'Moved to ' + t.name) })) };
      case 'parent': {
        const me = L[0], banned = me ? [me.id].concat(descendants(me.id)) : [];
        return { placeholder: 'Set parent issue…', items: (q) => {
          const out = me && me.parent ? [{ label: 'Remove parent issue', icon: ic('x', 14), always: true, run: () => A.set('parent', null) }] : [];
          return out.concat(db.issues.filter((x) => !banned.includes(x.id) && x.team === A.team).sort((a, b) => cmp(b.updatedAt, a.updatedAt))
            .map((x) => ({ label: x.title, keywords: ident(x), hint: ident(x), icon: statusIcon(x.status), checked: me && me.parent === x.id, run: () => A.set('parent', x.id) })).slice(0, q ? 50 : 12));
        } };
      }
      default: return { placeholder: '', items: [] };
    }
  }
  function openPicker(field, ids, anchor) {
    if (!ids || (Array.isArray(ids) && !ids.length)) return;
    const A = adapter(ids);
    if (A.list.length === 0 || (A.list[0] == null)) return;
    openMenu(fieldPage(field, A), { anchor });
  }
  function projectPicker(kind, pid, anchor) {
    const p = IDX.project.get(pid);
    if (!p) return;
    const setP = (f, v) => mutate(null, () => { if (same(p[f], v)) return false; p[f] = v; });
    let page;
    if (kind === 'pstatus') page = { placeholder: 'Project status…', items: PROJECT_STATUSES.map((s) => ({ label: s[1], icon: projStatusIcon(s[0]), checked: p.status === s[0], run: () => setP('status', s[0]) })) };
    else if (kind === 'plead') page = { placeholder: 'Project lead…', items: [{ label: 'No lead', icon: avatar(null, 18), checked: !p.lead, run: () => setP('lead', null) }].concat(db.members.map((m) => ({ label: m.name, icon: avatar(m, 18), checked: p.lead === m.id, run: () => setP('lead', m.id) }))) };
    else if (kind === 'pteam') page = { placeholder: 'Team…', items: db.teams.map((t) => ({ label: t.name, icon: teamIcon(t, 16), hint: t.key, checked: p.team === t.id, run: () => setP('team', t.id) })) };
    else {
      const t0 = today();
      page = { placeholder: 'Target date…', items: [['In two weeks', addDays(t0, 14)], ['In a month', addDays(t0, 30)], ['In a quarter', addDays(t0, 91)]].map((o) => ({ label: o[0], hint: fmtDay(o[1]), icon: ic('cal', 14), run: () => setP('target', o[1]) }))
        .concat(p.target ? [{ label: 'Remove target date', icon: ic('x', 14), run: () => setP('target', null) }] : []),
        footer: () => '<div class="pop-foot"><label class="sr" for="dueIn">Pick a date</label><input id="dueIn" type="date" class="tin" value="' + esc(p.target || '') + '"></div>', onDate: (v) => { if (v) { closeLayer(); setP('target', v); } } };
    }
    openMenu(page, { anchor });
  }

  // focused / selected / open issue
  function targets() {
    if (ui.selected.size) return Array.from(ui.selected);
    if (ui.route.kind === 'issue') { const i = IDX.ident.get(ui.route.ident); return i ? [i.id] : []; }
    if (ui.route.kind === 'inbox' && ui.route.sel) { const i = IDX.ident.get(ui.route.sel); return i ? [i.id] : []; }
    return ui.focus && issueById(ui.focus) ? [ui.focus] : [];
  }
  function anchorFor(field) {
    const ids = targets();
    if (ui.route.kind === 'issue' || (ui.route.kind === 'inbox' && ui.route.sel)) return document.querySelector('.issue-side [data-pick="' + field + '"]');
    if (ids.length === 1) {
      const row = document.querySelector('[data-row="' + ids[0] + '"]');
      if (row) return row.querySelector('[data-pick="' + field + '"]') || row;
    }
    return null;
  }

  function paletteRoot() {
    const ids = targets(), list = ids.map(issueById).filter(Boolean);
    const items = [];
    if (list.length) {
      const sec = list.length > 1 ? list.length + ' issues' : ident(list[0]);
      const A = adapter(ids);
      const add = (label, icon, kbds, page, extra) => items.push(Object.assign({ section: sec, label, icon, kbds, page }, extra || {}));
      add('Change status…', statusIcon('progress'), ['S'], () => fieldPage('status', adapter(ids)));
      add('Change priority…', prioIcon(2), ['P'], () => fieldPage('priority', adapter(ids)));
      add('Assign to…', ic('my'), ['A'], () => fieldPage('assignee', adapter(ids)));
      items.push({ section: sec, label: 'Assign to me', icon: ic('me'), kbds: ['I'], run: () => A.set('assignee', db.me) });
      add('Change labels…', ic('tag'), ['L'], () => fieldPage('labels', adapter(ids)));
      add('Set due date…', ic('cal'), ['D'], () => fieldPage('due', adapter(ids)));
      add('Move to project…', ic('project'), null, () => fieldPage('project', adapter(ids)));
      add('Add to cycle…', ic('cycle'), null, () => fieldPage('cycle', adapter(ids)));
      add('Set estimate…', ic('est'), ['E'], () => fieldPage('estimate', adapter(ids)));
      add('Move to team…', ic('users'), null, () => fieldPage('team', adapter(ids)));
      if (list.length === 1) {
        const i = list[0];
        add('Set parent issue…', ic('sub'), null, () => fieldPage('parent', adapter(ids)));
        items.push({ section: sec, label: 'Create sub-issue', icon: ic('plus'), run: () => openCreate({ team: i.team, parent: i.id, project: i.project, cycle: i.cycle }, true) });
        items.push({ section: sec, label: i.subscribers.includes(db.me) ? 'Unsubscribe' : 'Subscribe', icon: ic('bell'), run: () => toggleSubscribe(i) });
        items.push({ section: sec, label: 'Copy issue ID', icon: ic('copy'), run: () => copy(ident(i), 'Copied ' + ident(i)) });
        items.push({ section: sec, label: 'Copy issue link', icon: ic('link'), run: () => copy(issueUrl(i), 'Link copied') });
        if (ui.route.kind !== 'issue') items.push({ section: sec, label: 'Open issue', icon: ic('open'), kbds: ['↵'], run: () => go('#/issue/' + ident(i)) });
      }
      items.push({ section: sec, label: list.length > 1 ? 'Delete ' + list.length + ' issues…' : 'Delete issue…', icon: ic('trash'), kbds: ['⌘', '⌫'], danger: true, run: () => deleteIssues(ids) });
    }
    const nav = 'Navigation';
    items.push({ section: 'General', label: 'Create new issue', icon: ic('compose'), kbds: ['C'], run: () => openCreate() });
    if (ui.ctx) {
      const d = display(ui.ctx.key);
      items.push({ section: 'General', label: d.layout === 'board' ? 'Switch to list layout' : 'Switch to board layout', icon: ic(d.layout === 'board' ? 'list' : 'board'), run: () => setDisplay(ui.ctx.key, { layout: d.layout === 'board' ? 'list' : 'board' }) });
      items.push({ section: 'General', label: 'Group issues by…', icon: ic('display'), page: () => ({ placeholder: 'Group by…', items: GROUPS.map((g) => ({ label: g[1], checked: d.groupBy === g[0], run: () => setDisplay(ui.ctx.key, { groupBy: g[0] }) })) }) });
      if ((ui.filters[ui.ctx.key] || []).length) items.push({ section: 'General', label: 'Clear filters', icon: ic('filter'), run: () => { ui.filters[ui.ctx.key] = []; renderMain(); } });
    }
    items.push({ section: 'General', label: 'Undo', icon: ic('undo'), kbds: ['⌘', 'Z'], run: undo });
    items.push({ section: 'General', label: 'Act as…', icon: ic('users'), page: memberSwitchPage });
    items.push({ section: 'General', label: 'Keyboard shortcuts', icon: ic('key'), kbds: ['?'], run: shortcuts });
    items.push({ section: nav, label: 'Go to Inbox', icon: ic('inbox'), kbds: ['G', 'I'], run: () => go('#/inbox') });
    items.push({ section: nav, label: 'Go to My issues', icon: ic('my'), kbds: ['G', 'M'], run: () => go('#/my-issues/assigned') });
    items.push({ section: nav, label: 'Go to Projects', icon: ic('project'), kbds: ['G', 'P'], run: () => go('#/projects') });
    db.teams.forEach((t) => {
      items.push({ section: nav, label: 'Go to ' + t.name + ' issues', icon: teamIcon(t, 16), keywords: t.key, run: () => go('#/team/' + t.key + '/issues/all') });
      items.push({ section: nav, label: 'Go to ' + t.name + ' active issues', icon: teamIcon(t, 16), keywords: t.key, run: () => go('#/team/' + t.key + '/issues/active') });
      items.push({ section: nav, label: 'Go to ' + t.name + ' backlog', icon: teamIcon(t, 16), keywords: t.key, run: () => go('#/team/' + t.key + '/issues/backlog') });
      items.push({ section: nav, label: 'Go to ' + t.name + ' current cycle', icon: ic('cycle'), keywords: t.key, run: () => go('#/team/' + t.key + '/cycle/' + currentCycle(t)) });
    });
    items.push({ section: nav, label: 'Go to Settings', icon: ic('gear'), kbds: ['G', 'S'], run: () => go('#/settings') });
    return {
      placeholder: list.length ? 'Type a command or search…' : 'Search issues, projects or commands…',
      ctx: list.length ? list.slice(0, 3).map((i) => '<span class="chip">' + statusIcon(i.status, 12) + '<span>' + ident(i) + '</span></span>').join('') + (list.length > 3 ? '<span class="chip">+' + (list.length - 3) + '</span>' : '') : '',
      items: (q) => {
        if (!q) return items;
        const words = q.split(/\s+/).filter(Boolean);
        const hit = (s) => words.every((w) => s.toLowerCase().includes(w));
        const issues = db.issues.filter((i) => hit(ident(i) + ' ' + i.title)).sort((a, b) => (isClosed(a) ? 1 : 0) - (isClosed(b) ? 1 : 0) || cmp(b.updatedAt, a.updatedAt)).slice(0, 8)
          .map((i) => ({ section: 'Issues', label: i.title, hint: ident(i), icon: statusIcon(i.status), always: true, run: () => go('#/issue/' + ident(i)) }));
        const projs = db.projects.filter((p) => hit(p.name)).slice(0, 4).map((p) => ({ section: 'Projects', label: p.name, icon: projIcon(p), always: true, run: () => go('#/project/' + p.id) }));
        return issues.concat(projs, items.filter((it) => hit(it.label + ' ' + (it.keywords || '') + ' ' + (it.section || ''))).map((it) => Object.assign({}, it, { always: true })));
      }
    };
  }
  function memberSwitchPage() {
    return { placeholder: 'Act as…', items: db.members.map((m) => ({ label: m.name, icon: avatar(m, 18), checked: m.id === db.me, run: () => { db.me = m.id; save(); render(); toast('You are now acting as ' + m.name); } })) };
  }
  function openPalette() { openMenu(paletteRoot(), { palette: true }); }

  // display & filter menus
  function openDisplay(anchor) {
    if (!ui.ctx) return;
    const ret = document.activeElement;
    closeLayer(true);
    ui.layer = { type: 'form', returnFocus: ret };
    $('layers').innerHTML = '<div class="layer-scrim" data-layer-close></div><div class="pop" role="dialog" aria-modal="true" aria-label="Display options" id="dispBox"></div>';
    drawDisplay();
    position($('dispBox'), anchor);
    const f = $('dispBox').querySelector('button,select');
    if (f) f.focus();
  }
  function drawDisplay() {
    const key = ui.ctx.key, d = display(key);
    const sel = (name, opts, v) => '<select data-disp="' + name + '" aria-label="' + name + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    $('dispBox').innerHTML = '<div class="pop-form">' +
      '<div class="seg" role="group" aria-label="Layout" style="align-self:stretch;display:flex"><button type="button" style="flex:1;justify-content:center" data-disp-layout="list" class="' + (d.layout === 'list' ? 'on' : '') + '">' + ic('list') + 'List</button><button type="button" style="flex:1;justify-content:center" data-disp-layout="board" class="' + (d.layout === 'board' ? 'on' : '') + '">' + ic('board') + 'Board</button></div>' +
      '<div class="frow"><span>Grouping</span>' + sel('groupBy', GROUPS, d.groupBy) + '</div>' +
      '<div class="frow"><span>Ordering</span>' + sel('orderBy', ORDERS, d.orderBy) + '</div>' +
      '<div class="frow"><span>Completed issues</span>' + sel('completed', COMPLETED, d.completed) + '</div>' +
      '<div class="frow"><label for="dispSubs">Show sub-issues</label><input id="dispSubs" type="checkbox" class="toggle" data-disp-subs' + (d.subs ? ' checked' : '') + '></div>' +
      '<h4>Display properties</h4><div class="props">' + PROPS.map((p) => '<button type="button" data-disp-prop="' + p[0] + '" class="' + (d.props[p[0]] ? 'on' : '') + '" aria-pressed="' + !!d.props[p[0]] + '">' + esc(p[1]) + '</button>').join('') + '</div></div>';
  }
  function openFilter(anchor, prop) {
    if (!ui.ctx) return;
    const key = ui.ctx.key;
    const valuesPage = (pr) => {
      const name = FILTER_PROPS.find((p) => p[0] === pr)[1];
      const base = db.issues.filter(ui.ctx.base);
      const count = (fn) => base.filter(fn).length;
      let vals;
      switch (pr) {
        case 'status': vals = STATUSES.map((s) => [s.id, s.name, statusIcon(s.id), count((i) => i.status === s.id)]); break;
        case 'assignee': vals = [['', 'No assignee', avatar(null, 16), count((i) => !i.assignee)]].concat(db.members.map((m) => [m.id, m.name, avatar(m, 16), count((i) => i.assignee === m.id)])); break;
        case 'priority': vals = PRIO_MENU.map((p) => [p, PRIO_NAME[p], prioIcon(p), count((i) => (i.priority || 0) === p)]); break;
        case 'label': vals = db.labels.map((l) => [l.id, l.name, '<span class="dot" style="width:9px;height:9px;border-radius:50%;background:' + esc(l.color) + '"></span>', count((i) => i.labels.includes(l.id))]).concat([['', 'No labels', ic('tag', 14), count((i) => !i.labels.length)]]); break;
        case 'project': vals = [['', 'No project', projIcon(null), count((i) => !i.project)]].concat(db.projects.map((p) => [p.id, p.name, projIcon(p), count((i) => i.project === p.id)])); break;
        case 'cycle': vals = [['', 'No cycle', ic('cycle', 14), count((i) => i.cycle == null)]].concat(uniq(base.filter((i) => i.cycle != null).map((i) => i.cycle)).sort((a, b) => b - a).map((n) => [n, 'Cycle ' + n, ic('cycle', 14), count((i) => i.cycle === n)])); break;
        default: vals = DUE_BUCKETS.map((b) => [b[0], b[1], ic('cal', 14), count((i) => dueBucket(i) === b[0])]);
      }
      return {
        placeholder: name + '…', multi: true,
        items: () => {
          const f = (ui.filters[key] || []).find((x) => x.prop === pr);
          return vals.map((v) => ({ label: v[1], icon: v[2], hint: String(v[3]), checked: !!(f && f.values.includes(v[0])), run() { toggleFilter(key, pr, v[0]); } }));
        }
      };
    };
    if (prop) { openMenu(valuesPage(prop), { anchor }); return; }
    openMenu({ placeholder: 'Filter by…', items: FILTER_PROPS.map((p) => ({ label: p[1], icon: { status: statusIcon('progress'), assignee: ic('my', 14), priority: prioIcon(2), label: ic('tag', 14), project: ic('project', 14), cycle: ic('cycle', 14), due: ic('cal', 14) }[p[0]], page: () => valuesPage(p[0]) })) }, { anchor });
  }
  function toggleFilter(key, prop, v) {
    const fs = ui.filters[key] || (ui.filters[key] = []);
    let f = fs.find((x) => x.prop === prop);
    if (!f) { f = { prop, values: [] }; fs.push(f); }
    f.values = f.values.includes(v) ? f.values.filter((x) => x !== v) : f.values.concat([v]);
    ui.filters[key] = fs.filter((x) => x.values.length);
    renderMain();
  }

  // create issue modal
  function openCreate(preset, fresh) {
    const p = preset || {}, ctxPreset = ui.ctx ? ui.ctx.preset : {};
    const base = Object.assign({}, ctxPreset, p);
    if (!ui.draft || fresh) {
      ui.draft = { team: base.team || (ui.ctx && ui.ctx.team) || (ui.route.team) || db.teams[0].id, title: '', description: '', status: base.status || 'todo', priority: base.priority || 0,
        assignee: base.assignee === undefined ? null : base.assignee, labels: (base.labels || []).slice(), project: base.project || null, cycle: base.cycle == null ? null : base.cycle, due: base.due || null, estimate: null, parent: base.parent || null };
    } else {
      Object.keys(p).forEach((k) => { ui.draft[k] = p[k]; });
    }
    const ret = document.activeElement;
    closeLayer(true);
    ui.layer = { type: 'create', returnFocus: ret, more: ui.layer && ui.layer.more };
    const d = ui.draft;
    $('layers').innerHTML = '<div class="layer-scrim dim" data-layer-close></div><div class="modal" role="dialog" aria-modal="true" aria-label="New issue" id="createBox">' +
      '<div class="modal-head"><span id="cTeam"></span><span>' + ic('chevR', 12) + '</span><span>' + (d.parent && issueById(d.parent) ? 'New sub-issue of ' + ident(issueById(d.parent)) : 'New issue') + '</span>' +
      '<button type="button" class="round" data-layer-close aria-label="Close (Esc)" title="Close  Esc">' + ic('x') + '</button></div>' +
      '<div class="modal-body"><label class="sr" for="cTitle">Issue title</label><input id="cTitle" class="ctitle" placeholder="Issue title" autocomplete="off" value="' + esc(d.title) + '">' +
      '<label class="sr" for="cDesc">Description</label><textarea id="cDesc" class="cdesc" data-auto placeholder="Add description…">' + esc(d.description) + '</textarea><div class="err" id="cErr" role="alert"></div></div>' +
      '<div class="cprops" id="cProps"></div>' +
      '<div class="modal-foot"><span><kbd>⌘</kbd> <kbd>↵</kbd> to create</span><label><input type="checkbox" class="toggle" id="cMore"' + (ui.layer.more ? ' checked' : '') + '>Create more</label>' +
      '<button type="button" class="btn primary" data-act="create-submit">Create issue</button></div></div>';
    drawCreateProps();
    autosize($('cDesc'));
    $('cTitle').focus();
  }
  function drawCreateProps() {
    const d = ui.draft, box = $('cProps');
    if (!box) return;
    const t = team(d.team), p = IDX.project.get(d.project);
    $('cTeam').innerHTML = '<button type="button" class="team-pick" data-pick="team" data-draft="1" aria-label="Team: ' + esc(t.name) + '">' + teamIcon(t, 16) + esc(t.key) + '</button>';
    const pill = (field, inner, label) => '<button type="button" class="pill" data-pick="' + field + '" data-draft="1" aria-label="' + label + '">' + inner + '</button>';
    const labels = d.labels.map((l) => IDX.label.get(l)).filter(Boolean);
    box.innerHTML = pill('status', statusIcon(d.status) + STATUS[d.status].name, 'Status') +
      pill('priority', prioIcon(d.priority) + (d.priority ? PRIO_NAME[d.priority] : '<span class="muted">Priority</span>'), 'Priority') +
      pill('assignee', avatar(member(d.assignee), 16) + (d.assignee ? esc(memberName(d.assignee)) : '<span class="muted">Assignee</span>'), 'Assignee') +
      pill('labels', labels.length ? labels.map((l) => '<span class="dot" style="width:8px;height:8px;border-radius:50%;background:' + esc(l.color) + '"></span>' + esc(l.name)).join(' ') : ic('tag') + '<span class="muted">Labels</span>', 'Labels') +
      pill('project', projIcon(p) + (p ? esc(p.name) : '<span class="muted">Project</span>'), 'Project') +
      pill('cycle', ic('cycle') + (d.cycle != null ? 'Cycle ' + d.cycle : '<span class="muted">Cycle</span>'), 'Cycle') +
      pill('due', ic('cal') + (d.due ? esc(dueText(d.due)) : '<span class="muted">Due date</span>'), 'Due date') +
      pill('estimate', ic('est') + (d.estimate ? d.estimate + ' pts' : '<span class="muted">Estimate</span>'), 'Estimate');
  }
  function submitCreate() {
    const d = ui.draft;
    d.title = $('cTitle').value; d.description = $('cDesc').value;
    if (!d.title.trim()) { $('cErr').textContent = 'Give the issue a title.'; $('cTitle').focus(); return; }
    let created;
    const more = $('cMore').checked;
    ui.layer.more = more;
    mutate(null, () => { created = createIssue(d); });
    toast('Created ' + ident(created), { label: 'Open', run: () => go('#/issue/' + ident(created)) });
    if (more) {
      ui.draft = Object.assign({}, d, { title: '', description: '' });
      const keepMore = ui.layer;
      openCreate(null, false);
      ui.layer.more = keepMore ? keepMore.more : true;
      $('cMore').checked = true;
    } else { ui.draft = null; closeLayer(); }
  }

  function newProjectDialog(teamId) {
    const ret = document.activeElement;
    closeLayer(true);
    ui.layer = { type: 'form', returnFocus: ret };
    const t = teamId ? team(teamId) : db.teams[0];
    $('layers').innerHTML = '<div class="layer-scrim dim" data-layer-close></div><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="npT"><h2 id="npT">New project</h2>' +
      '<div class="pop-form" style="padding:8px 0 0;min-width:0"><div class="frow"><label for="npName">Name</label><input id="npName" class="tin" style="flex:1" placeholder="Project name"></div>' +
      '<div class="frow"><label for="npTeam">Team</label><select id="npTeam">' + db.teams.map((x) => '<option value="' + x.id + '"' + (x.id === t.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
      '<div class="frow"><label for="npLead">Lead</label><select id="npLead"><option value="">No lead</option>' + db.members.map((m) => '<option value="' + m.id + '"' + (m.id === db.me ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>' +
      '<div class="frow"><label for="npTarget">Target date</label><input id="npTarget" type="date" class="tin"></div><div class="err" id="npErr" role="alert"></div></div>' +
      '<div class="acts"><button type="button" class="btn" data-layer-close>Cancel</button><button type="button" class="btn primary" data-act="project-create">Create project</button></div></div>';
    $('npName').focus();
  }

  // ── actions ──────────────────────────────────────────────────────────────
  function issueUrl(i) { return location.origin + location.pathname + '#/issue/' + ident(i); }
  function copy(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text));
    else toast(text);
  }
  function toggleSubscribe(i) {
    const on = !i.subscribers.includes(db.me);
    mutate(null, () => { i.subscribers = on ? i.subscribers.concat(db.me) : i.subscribers.filter((x) => x !== db.me); });
    toast(on ? 'Subscribed to ' + ident(i) : 'Unsubscribed from ' + ident(i));
  }
  function deleteIssues(ids) {
    const list = ids.map(issueById).filter(Boolean);
    if (!list.length) return;
    const label = list.length === 1 ? ident(list[0]) : list.length + ' issues';
    confirmBox('Delete ' + label + '?', list.length === 1 ? '“' + list[0].title + '” and its activity will be deleted. Sub-issues stay, without a parent.' : 'These issues and their activity will be deleted. Sub-issues stay, without a parent.', 'Delete', true).then((ok) => {
      if (!ok) return;
      const set = new Set(list.map((i) => i.id));
      mutate('Deleted ' + label, () => {
        db.issues = db.issues.filter((i) => !set.has(i.id));
        db.issues.forEach((i) => { if (set.has(i.parent)) i.parent = null; });
      });
      ui.selected.clear(); renderBulk();
      if (ui.route.kind === 'issue') go(ui.lastList);
    });
  }
  function addComment(i) {
    const el = $('cmtIn'), text = (el ? el.value : ui.comment[i.id] || '').trim();
    if (!text) { if (el) el.focus(); return; }
    mutate(null, () => {
      i.activity.push({ id: uid('a'), type: 'comment', actor: db.me, at: nowIso(), text });
      if (!i.subscribers.includes(db.me)) i.subscribers.push(db.me);
      i.updatedAt = nowIso();
    });
    ui.comment[i.id] = '';
    const n = $('cmtIn'); if (n) { n.value = ''; autosize(n); n.focus(); }
  }
  function setFocus(id, kb) {
    if (ui.focus === id && ui.kfocus === kb) return;
    document.querySelectorAll('[data-row].focus').forEach((el) => el.classList.remove('focus', 'kfocus'));
    ui.focus = id; ui.kfocus = !!kb;
    if (!id) return;
    document.querySelectorAll('[data-row="' + id + '"]').forEach((el) => {
      el.classList.add('focus'); if (kb) el.classList.add('kfocus');
      if (kb) el.scrollIntoView({ block: 'nearest' });
    });
  }
  function moveFocus(dir) {
    if (ui.route.kind === 'issue') { stepIssue(dir); return; }
    if (ui.route.kind === 'inbox') {
      const k = ui.order.indexOf((IDX.ident.get(ui.route.sel) || {}).id), n = ui.order[Math.max(0, Math.min(ui.order.length - 1, k + dir))] || ui.order[0];
      if (n) go('#/inbox/' + ident(issueById(n)));
      return;
    }
    if (!ui.order.length) return;
    const k = ui.order.indexOf(ui.focus);
    setFocus(ui.order[k < 0 ? (dir > 0 ? 0 : ui.order.length - 1) : Math.max(0, Math.min(ui.order.length - 1, k + dir))], true);
  }
  function stepIssue(dir) {
    const i = IDX.ident.get(ui.route.ident);
    const k = i ? ui.order.indexOf(i.id) : -1;
    if (k < 0) return;
    const n = ui.order[k + dir];
    if (n) { ui.focus = n; go('#/issue/' + ident(issueById(n))); }
  }
  function toggleSel(id, range) {
    if (range && ui.anchor && ui.order.includes(ui.anchor) && ui.order.includes(id)) {
      const a = ui.order.indexOf(ui.anchor), b = ui.order.indexOf(id);
      ui.order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => ui.selected.add(x));
    } else {
      if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
      ui.anchor = id;
    }
    renderMain(); renderBulk();
  }

  const ACTIONS = {
    nav: () => document.getElementById('app').classList.toggle('nav-open'),
    shortcuts: () => shortcuts(),
    palette: () => openPalette(),
    create: () => openCreate(),
    'create-submit': () => submitCreate(),
    'act-as': (el) => openMenu(memberSwitchPage(), { anchor: el }),
    'team-toggle': (el) => { ui.teamOpen[el.dataset.id] = ui.teamOpen[el.dataset.id] === false; renderSide(); },
    layout: (el) => { if (ui.ctx) setDisplay(ui.ctx.key, { layout: el.dataset.v }); },
    display: (el) => openDisplay(el),
    filter: (el) => openFilter(el),
    'filter-edit': (el) => openFilter(el, el.dataset.prop),
    'filter-del': (el) => { ui.filters[ui.ctx.key] = (ui.filters[ui.ctx.key] || []).filter((f) => f.prop !== el.dataset.prop); renderMain(); },
    'filter-clear': () => { if (ui.ctx) { ui.filters[ui.ctx.key] = []; ui.search[ui.ctx.key] = ''; renderMain(); } },
    collapse: (el) => { ui.collapsed[el.dataset.ck] = !ui.collapsed[el.dataset.ck]; refreshList(); },
    gadd: (el) => { const f = el.dataset.gfield, v = JSON.parse(el.dataset.gval); const p = {}; p[f] = f === 'labels' ? [v] : v; if (f === 'project' && v && IDX.project.get(v)) p.team = IDX.project.get(v).team; openCreate(p, true); },
    sel: (el, e) => { toggleSel(el.dataset.id, e.shiftKey); },
    'sel-clear': () => { ui.selected.clear(); renderMain(); renderBulk(); },
    delete: () => deleteIssues(targets()),
    'issue-step': (el) => stepIssue(Number(el.dataset.v)),
    'copy-link': (el) => { const i = issueById(el.dataset.id); if (i) copy(issueUrl(i), 'Link copied'); },
    'issue-menu': () => openPalette(),
    subscribe: (el) => { const i = issueById(el.dataset.id); if (i) toggleSubscribe(i); },
    comment: (el) => { const i = issueById(el.dataset.id); if (i) addComment(i); },
    'comment-del': (el) => {
      const i = issueById(el.dataset.id);
      if (i) mutate('Deleted comment', () => { i.activity = i.activity.filter((a) => a.id !== el.dataset.ev); });
    },
    'inbox-readall': () => { const st = inboxState(); inboxItems().forEach((x) => { st.read[x.issue.id] = nowIso(); }); save(); render(); },
    'inbox-clear': (el) => {
      const st = inboxState(), items = inboxItems(), k = items.findIndex((x) => x.issue.id === el.dataset.id);
      st.cleared[el.dataset.id] = nowIso(); st.read[el.dataset.id] = nowIso(); save();
      const next = items[k + 1] || items[k - 1];
      go(next && next.issue.id !== el.dataset.id ? '#/inbox/' + ident(next.issue) : '#/inbox');
    },
    brk: (el) => { ui.brk = el.dataset.v; renderMain(); },
    'cycle-step': (el) => { const t = team(ui.route.team); go('#/team/' + t.key + '/cycle/' + Math.max(1, ui.route.n + Number(el.dataset.v))); },
    'new-project': (el) => newProjectDialog(el.dataset.team || ui.route.team),
    'project-create': () => {
      const name = $('npName').value.trim();
      if (!name) { $('npErr').textContent = 'Give the project a name.'; $('npName').focus(); return; }
      const p = { id: uid('p'), name, team: $('npTeam').value, lead: $('npLead').value || null, status: 'planned', target: $('npTarget').value || null, color: COLORS[db.projects.length % COLORS.length], description: '', createdAt: nowIso() };
      closeLayer(true);
      mutate(null, () => { db.projects.push(p); });
      go('#/project/' + p.id);
    },
    'project-menu': (el) => {
      const p = IDX.project.get(el.dataset.pid);
      openMenu({ placeholder: 'Project actions…', items: [
        { label: 'Rename…', icon: ic('compose', 14), run: () => promptBox('Rename project', 'Project name', p.name, 'Rename').then((v) => { if (v && v.trim() && v.trim() !== p.name) mutate(null, () => { p.name = v.trim(); }); }) },
        { label: 'Copy project link', icon: ic('link', 14), run: () => copy(location.origin + location.pathname + '#/project/' + p.id, 'Link copied') },
        { label: 'Change colour…', icon: projIcon(p), page: () => ({ placeholder: 'Colour…', items: COLORS.map((c) => ({ label: c, icon: '<span class="dot" style="width:12px;height:12px;border-radius:50%;background:' + c + '"></span>', checked: p.color === c, run: () => mutate(null, () => { p.color = c; }) })) }) },
        { label: 'Delete project…', icon: ic('trash', 14), danger: true, run: () => confirmBox('Delete “' + p.name + '”?', 'Its issues stay, without a project.', 'Delete project', true).then((ok) => { if (!ok) return; mutate('Deleted ' + p.name, () => { db.projects = db.projects.filter((x) => x.id !== p.id); db.issues.forEach((i) => { if (i.project === p.id) i.project = null; }); }); go('#/projects'); }) }
      ] }, { anchor: el });
    },
    'member-add': () => {
      const el = $('newMember'), name = el.value.trim();
      if (!name) { el.focus(); return; }
      mutate('Added ' + name, () => { db.members.push({ id: uid('m'), name, color: COLORS[db.members.length % COLORS.length] }); });
      const n = $('newMember'); if (n) n.focus();
    },
    'member-del': (el) => {
      const m = member(el.dataset.id);
      if (!m || m.id === db.me) return;
      confirmBox('Remove ' + m.name + '?', 'Their open issues become unassigned. Past activity keeps their name as "Former member".', 'Remove', true).then((ok) => {
        if (!ok) return;
        mutate('Removed ' + m.name, () => { db.members = db.members.filter((x) => x.id !== m.id); db.issues.forEach((i) => { if (i.assignee === m.id) i.assignee = null; i.subscribers = i.subscribers.filter((x) => x !== m.id); }); db.projects.forEach((p) => { if (p.lead === m.id) p.lead = null; }); });
      });
    },
    'label-add': () => {
      const el = $('newLabel'), name = el.value.trim();
      if (!name) { el.focus(); return; }
      mutate('Added label ' + name, () => { db.labels.push({ id: uid('l'), name, color: COLORS[db.labels.length % COLORS.length] }); });
      const n = $('newLabel'); if (n) n.focus();
    },
    'label-del': (el) => {
      const l = IDX.label.get(el.dataset.id);
      if (l) mutate('Deleted label ' + l.name, () => { db.labels = db.labels.filter((x) => x.id !== l.id); db.issues.forEach((i) => { i.labels = i.labels.filter((x) => x !== l.id); }); });
    },
    'team-add': () => {
      const name = $('newTeam').value.trim(), key = $('newTeamKey').value.trim().toUpperCase();
      if (!name) { $('newTeam').focus(); return; }
      if (!/^[A-Z]{2,5}$/.test(key)) { toast('The prefix needs 2–5 letters, e.g. MKT'); $('newTeamKey').focus(); return; }
      if (IDX.teamKey.has(key)) { toast('Another team already uses ' + key); $('newTeamKey').focus(); return; }
      const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      mutate('Added team ' + name, () => { db.teams.push({ id: uid('t'), key, name, color: COLORS[db.teams.length % COLORS.length], next: 1, cycleStart: ymd(d), cycleDays: 14 }); });
    },
    'team-del': (el) => {
      const t = IDX.team.get(el.dataset.id);
      if (!t || db.issues.some((i) => i.team === t.id) || db.teams.length < 2) return;
      mutate('Deleted team ' + t.name, () => { db.teams = db.teams.filter((x) => x.id !== t.id); db.projects.forEach((p) => { if (p.team === t.id) p.team = db.teams[0].id; }); });
    },
    export: () => {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'team-tasks-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    'reset-demo': () => confirmBox('Reset to the demo workspace?', 'Everything in this browser is replaced with fresh demo data. Export first if you want to keep it.', 'Reset', true).then((ok) => {
      if (!ok) return;
      db = window.TeamTasksSeed(new Date()); ensure(); reindex(); ui.undo = []; ui.selected.clear(); ui.filters = {}; ui.search = {};
      flush(); go('#/my-issues/assigned'); render(); toast('Demo workspace restored');
    }),
    empty: () => confirmBox('Start with an empty workspace?', 'All issues and projects are removed. Members, labels and teams stay.', 'Start empty', true).then((ok) => {
      if (!ok) return;
      mutate('Cleared the workspace', () => { db.issues = []; db.projects = []; db.inbox = {}; });
    })
  };

  // ── events ───────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-layer-close]')) { e.preventDefault(); closeLayer(); return; }
    const dlg = t.closest('[data-dlg]');
    if (dlg && ui.layer && ui.layer.prompt && dlg.dataset.dlg === '2') { const v = $('dlgIn').value, fn = ui.layer.prompt; ui.layer.resolve = null; closeLayer(); fn(v); return; }
    if (dlg && ui.layer && ui.layer.resolve) { const res = ui.layer.resolve; ui.layer.resolve = null; closeLayer(); res(dlg.dataset.dlg === '1'); return; }
    const opt = t.closest('.opt[data-k]');
    if (opt && ui.layer && ui.layer.type === 'menu') { e.preventDefault(); chooseMenu(Number(opt.dataset.k)); return; }
    // display menu controls
    const dl = t.closest('[data-disp-layout]');
    if (dl) { setDisplay(ui.ctx.key, { layout: dl.dataset.dispLayout }); drawDisplay(); return; }
    const dp = t.closest('[data-disp-prop]');
    if (dp) { const d = display(ui.ctx.key), props = Object.assign({}, d.props); props[dp.dataset.dispProp] = !props[dp.dataset.dispProp]; setDisplay(ui.ctx.key, { props }); drawDisplay(); const b = $('dispBox').querySelector('[data-disp-prop="' + dp.dataset.dispProp + '"]'); if (b) b.focus(); return; }
    const pick = t.closest('[data-pick]');
    if (pick) {
      e.preventDefault(); e.stopPropagation();
      const f = pick.dataset.pick;
      if (pick.dataset.pid) { projectPicker(f, pick.dataset.pid, pick); return; }
      if (pick.dataset.draft) { openMenu(fieldPage(f, adapter('draft')), { anchor: pick, over: true }); return; }
      let ids;
      if (pick.dataset.bulk) ids = Array.from(ui.selected);
      else ids = ui.selected.has(pick.dataset.id) && ui.selected.size > 1 ? Array.from(ui.selected) : [pick.dataset.id];
      openPicker(f, ids, pick);
      return;
    }
    const a = t.closest('[data-act]');
    if (a && ACTIONS[a.dataset.act]) {
      if (a.tagName !== 'INPUT') e.preventDefault();
      ACTIONS[a.dataset.act](a, e);
      return;
    }
    const row = t.closest('[data-row]');
    if (row && !t.closest('a,button,input,label,select,textarea')) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) { toggleSel(row.dataset.row, e.shiftKey); return; }
      const i = issueById(row.dataset.row);
      if (i) { ui.focus = i.id; go('#/issue/' + ident(i)); }
    }
    if (document.getElementById('app').classList.contains('nav-open') && !t.closest('.side')) document.getElementById('app').classList.remove('nav-open');
  });
  document.addEventListener('mouseover', (e) => {
    if (ui.layer && ui.layer.type === 'menu') {
      const o = e.target.closest('.opt[data-k]');
      if (o && Number(o.dataset.k) !== ui.layer.active) {
        ui.layer.active = Number(o.dataset.k);
        document.querySelectorAll('#menuList .opt.on').forEach((x) => x.classList.remove('on'));
        o.classList.add('on');
        $('menuIn').setAttribute('aria-activedescendant', o.id);
      }
      return;
    }
    const row = e.target.closest && e.target.closest('[data-row]');
    if (row && !ui.drag) setFocus(row.dataset.row, false);
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'menuIn' && ui.layer && ui.layer.type === 'menu') { ui.layer.q = t.value; ui.layer.active = 0; drawMenu(); return; }
    if (t.matches('textarea[data-auto]')) autosize(t);
    if (t.dataset.actInput === 'search' && ui.ctx) { ui.search[ui.ctx.key] = t.value; refreshList(); return; }
    if (t.dataset.actInput === 'comment') { ui.comment[t.dataset.id] = t.value; return; }
    if (t.dataset.field) {
      const i = issueById(t.dataset.id);
      if (!i) return;
      if (!ui.edit || ui.edit.id !== i.id || ui.edit.field !== t.dataset.field) ui.edit = { id: i.id, field: t.dataset.field, from: i[t.dataset.field] };
      i[t.dataset.field] = t.dataset.field === 'title' ? t.value.replace(/\n/g, ' ') : t.value;
      i.updatedAt = nowIso();
      save();
      return;
    }
    if (t.dataset.pfield) {
      const p = IDX.project.get(t.dataset.id);
      if (p) { p[t.dataset.pfield] = t.value; save(); }
      return;
    }
    if (t.dataset.set === 'ws-name') { db.workspace.name = t.value; save(); renderSide(); return; }
    if (t.dataset.set === 'member-name' || t.dataset.set === 'label-name' || t.dataset.set === 'team-name') {
      const coll = { 'member-name': db.members, 'label-name': db.labels, 'team-name': db.teams }[t.dataset.set];
      const x = coll.find((y) => y.id === t.dataset.id);
      if (x && t.value.trim()) { x.name = t.value; save(); renderSide(); }
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'dueIn' && ui.layer && ui.layer.stack) { const p = topPage(); if (p.onDate) p.onDate(t.value); return; }
    if (t.dataset.disp) { setDisplay(ui.ctx.key, { [t.dataset.disp]: t.value }); return; }
    if (t.hasAttribute('data-disp-subs')) { setDisplay(ui.ctx.key, { subs: t.checked }); return; }
    if (t.dataset.field === 'title') {
      const i = issueById(t.dataset.id);
      if (!i) return;
      if (!t.value.trim()) { i.title = ui.edit && ui.edit.from || 'Untitled'; t.value = i.title; }
      if (ui.edit && ui.edit.id === i.id && ui.edit.field === 'title' && ui.edit.from !== i.title) { logChange(i, 'title', ui.edit.from, i.title); save(); }
      ui.edit = null;
      return;
    }
    if (t.dataset.field === 'description') { ui.edit = null; return; }
    if (t.dataset.pfield === 'name') { const p = IDX.project.get(t.dataset.id); if (p && !t.value.trim()) { p.name = 'Untitled project'; t.value = p.name; save(); } renderSide(); return; }
    if (t.dataset.set === 'member-color' || t.dataset.set === 'label-color' || t.dataset.set === 'team-color') {
      const coll = { 'member-color': db.members, 'label-color': db.labels, 'team-color': db.teams }[t.dataset.set];
      const x = coll.find((y) => y.id === t.dataset.id);
      if (x) mutate(null, () => { x.color = t.value; });
      return;
    }
    if (t.dataset.actFile === 'import' && t.files && t.files[0]) {
      const f = t.files[0];
      f.text().then((txt) => {
        let data;
        try { data = JSON.parse(txt); } catch (x) { toast('That file is not JSON.'); return; }
        if (!valid(data)) { toast('That file is not a Team Tasks export.'); return; }
        confirmBox('Replace this workspace?', 'Everything in this browser is replaced with “' + f.name + '”.', 'Import', true).then((ok) => {
          if (!ok) return;
          db = data; ensure(); reindex(); ui.undo = []; flush(); render(); toast('Imported ' + f.name);
        });
      });
      t.value = '';
    }
  });
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.set && /-name$/.test(t.dataset.set) && !t.value.trim()) render();
  });

  // board drag & drop (desktop)
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('.card[data-row]');
    if (!c) return;
    ui.drag = c.dataset.row;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', ident(issueById(ui.drag))); } catch (x) { /* some browsers */ }
    c.classList.add('dragging');
  });
  document.addEventListener('dragend', () => { ui.drag = null; document.querySelectorAll('.dragging,.drop').forEach((x) => x.classList.remove('dragging', 'drop')); });
  document.addEventListener('dragover', (e) => {
    const b = e.target.closest && e.target.closest('.col-body[data-gfield]');
    if (!b || !ui.drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.col-body.drop').forEach((x) => { if (x !== b) x.classList.remove('drop'); });
    b.classList.add('drop');
  });
  document.addEventListener('drop', (e) => {
    const b = e.target.closest && e.target.closest('.col-body[data-gfield]');
    if (!b || !ui.drag) return;
    e.preventDefault();
    const field = b.dataset.gfield, val = JSON.parse(b.dataset.gval);
    const ids = ui.selected.has(ui.drag) ? Array.from(ui.selected) : [ui.drag];
    ui.drag = null;
    adapter(ids).set(field, val);
  });

  function inField(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); }
  document.addEventListener('keydown', (e) => {
    const k = e.key, mod = e.metaKey || e.ctrlKey, t = e.target;
    if (mod && k.toLowerCase() === 'k') { e.preventDefault(); if (ui.layer && ui.layer.palette) closeLayer(); else openPalette(); return; }
    // layers
    if (ui.layer) {
      if (ui.layer.type === 'menu' && t.id === 'menuIn') { menuKey(e); return; }
      if (ui.layer.type === 'create') {
        if (k === 'Escape') { e.preventDefault(); const d = ui.draft; if (d) { d.title = $('cTitle').value; d.description = $('cDesc').value; } closeLayer(); return; }
        if (mod && k === 'Enter') { e.preventDefault(); submitCreate(); return; }
        if (k === 'Enter' && t.id === 'cTitle') { e.preventDefault(); $('cDesc').focus(); return; }
        if (t.id === 'cTitle' || t.id === 'cDesc') { const d = ui.draft; if (d) setTimeout(() => { if ($('cTitle')) { d.title = $('cTitle').value; d.description = $('cDesc').value; } }, 0); }
        if (k === 'Tab') trapTab(e, $('createBox'));
        return;
      }
      if (k === 'Escape') { e.preventDefault(); closeLayer(); return; }
      if (k === 'Enter' && t.id === 'npName') { e.preventDefault(); ACTIONS['project-create'](); return; }
      if (k === 'Enter' && t.id === 'dlgIn' && ui.layer.prompt) { e.preventDefault(); const v = t.value, fn = ui.layer.prompt; ui.layer.resolve = null; closeLayer(); fn(v); return; }
      if (k === 'Tab') trapTab(e, $('layers').querySelector('.dialog,.pop,.modal,.palette'));
      return;
    }
    // text fields
    if (inField(t)) {
      if (k === 'Escape') { t.blur(); return; }
      if (t.dataset.field === 'title' && k === 'Enter') { e.preventDefault(); t.blur(); return; }
      if (t.dataset.actInput === 'comment' && mod && k === 'Enter') { e.preventDefault(); const i = issueById(t.dataset.id); if (i) addComment(i); return; }
      if (t.dataset.actInput === 'sub' && k === 'Enter') {
        e.preventDefault();
        const i = issueById(t.dataset.id), title = t.value.trim();
        if (!i || !title) return;
        mutate(null, () => { createIssue({ team: i.team, title, parent: i.id, status: 'todo', project: i.project, cycle: i.cycle }); });
        const n = $('subIn'); if (n) { n.value = ''; n.focus(); }
        return;
      }
      if (t.id === 'newMember' && k === 'Enter') { e.preventDefault(); ACTIONS['member-add'](); return; }
      if (t.id === 'newLabel' && k === 'Enter') { e.preventDefault(); ACTIONS['label-add'](); return; }
      if ((t.id === 'newTeam' || t.id === 'newTeamKey') && k === 'Enter') { e.preventDefault(); ACTIONS['team-add'](); return; }
      if (t.dataset.actInput === 'search' && (k === 'ArrowDown' || k === 'Enter') && ui.order.length) { e.preventDefault(); t.blur(); setFocus(ui.order[0], true); return; }
      return;
    }
    if (mod && (k === 'Backspace' || k === 'Delete')) { e.preventDefault(); deleteIssues(targets()); return; }
    if (mod && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod || e.altKey) return;
    if (ui.gPending) {
      ui.gPending = false;
      const tm = IDX.team.get(ui.route.team) || IDX.team.get((issueById(ui.focus) || {}).team) || db.teams[0];
      const map = { i: '#/inbox', m: '#/my-issues/assigned', p: '#/projects', s: '#/settings', t: '#/team/' + tm.key + '/issues/all', a: '#/team/' + tm.key + '/issues/active', b: '#/team/' + tm.key + '/issues/backlog', c: '#/team/' + tm.key + '/cycles' };
      if (map[k.toLowerCase()]) { e.preventDefault(); go(map[k.toLowerCase()]); }
      return;
    }
    const lower = k.length === 1 ? k.toLowerCase() : k;
    const pickKeys = { s: 'status', p: 'priority', a: 'assignee', l: 'labels', d: 'due', e: 'estimate' };
    if (pickKeys[lower] && !e.shiftKey) {
      const ids = targets();
      if (ids.length) { e.preventDefault(); openPicker(pickKeys[lower], ids, anchorFor(pickKeys[lower])); }
      return;
    }
    switch (lower) {
      case 'c': e.preventDefault(); openCreate(); break;
      case 'g': ui.gPending = true; setTimeout(() => { ui.gPending = false; }, 1200); break;
      case '/': {
        e.preventDefault();
        const s = document.querySelector('[data-act-input="search"]');
        if (s) s.focus(); else openPalette();
        break;
      }
      case '?': e.preventDefault(); shortcuts(); break;
      case 'j': case 'ArrowDown': if (ui.order.length && (lower === 'j' || ui.route.kind !== 'issue')) { e.preventDefault(); moveFocus(1); } break;
      case 'k': case 'ArrowUp': if (ui.order.length && (lower === 'k' || ui.route.kind !== 'issue')) { e.preventDefault(); moveFocus(-1); } break;
      case 'Enter': case 'o': if (ui.focus && issueById(ui.focus) && ui.route.kind !== 'issue' && ui.route.kind !== 'inbox' && (t === document.body || t.id === 'main' || !t.closest('a,button'))) { e.preventDefault(); go('#/issue/' + ident(issueById(ui.focus))); } break;
      case 'x': if (ui.focus && ui.order.includes(ui.focus)) { e.preventDefault(); toggleSel(ui.focus, e.shiftKey); } break;
      case 'i': { const ids = targets(); if (ids.length) { e.preventDefault(); adapter(ids).set('assignee', db.me, 'Assigned to you'); } break; }
      case 'Escape':
        if (ui.selected.size) { ui.selected.clear(); renderMain(); renderBulk(); }
        else if (ui.route.kind === 'issue') go(ui.lastList);
        else if (document.getElementById('app').classList.contains('nav-open')) document.getElementById('app').classList.remove('nav-open');
        break;
      default: break;
    }
  });
  function trapTab(e, box) {
    if (!box) return;
    const f = Array.from(box.querySelectorAll('button,input,select,textarea,a[href]')).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  window.addEventListener('hashchange', onRoute);
  // titles and descriptions grow with their text; re-measure once the web font has loaded and on resize
  const resizeAll = () => document.querySelectorAll('textarea[data-auto]').forEach(autosize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resizeAll);
  let resizeT = null;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(resizeAll, 120); });
  if (channel) {
    channel.onmessage = (e) => {
      if (!e.data || e.data.type !== 'changed' || saveTimer) return;
      idbGet().then((n) => {
        if (!valid(n)) return;
        db = n; ensure(); reindex();
        const a = document.activeElement;
        if (ui.layer || (a && inField(a) && $('main').contains(a))) { pendingRemote = true; return; }
        render();
      }).catch(() => {});
    };
  }
  document.addEventListener('focusout', () => { if (pendingRemote) setTimeout(() => { const a = document.activeElement; if (!ui.layer && !(a && inField(a))) { pendingRemote = false; render(); } }, 0); });

  // ── start ────────────────────────────────────────────────────────────────
  function applyCloud(data) {
    if (!valid(data)) return Promise.reject(new Error('The cloud copy is not Team Tasks data this version can read.'));
    clearTimeout(saveTimer); saveTimer = null;
    db = data; ensure(); reindex(); ui.undo = []; ui.selected.clear();
    const w = idbOK ? idbPut(db).then(() => { if (channel) channel.postMessage({ type: 'changed' }); }).catch(() => {}) : Promise.resolve();
    return w.then(() => { closeLayer(true); onRoute(); toast('Loaded your Team Tasks from the cloud'); });
  }
  async function start() {
    let stored = null;
    try { stored = await idbGet(); } catch (e) { idbOK = false; }
    if (valid(stored)) db = stored;
    else {
      db = window.TeamTasksSeed(new Date());
      if (idbOK) { try { await idbPut(db); } catch (e) { idbOK = false; } }
    }
    ensure(); reindex();
    if (!location.hash || location.hash === '#' || location.hash === '#/') history.replaceState(null, '', '#/my-issues/assigned');
    ui.route = parseHash();
    if (listCtx(ui.route)) ui.lastList = location.hash;
    render();
    if (!idbOK) toast('This browser blocks local storage here, so changes last only until you close the tab.');
    if (window.AdrialSync) {
      try {
        SYNC = window.AdrialSync.attach({ app: 'tasks', label: 'Team Tasks', getSnapshot: () => Promise.resolve(db), applySnapshot: applyCloud });
        if (ui.route.kind === 'settings') afterRender();
      } catch (e) { console.warn('Team Tasks: cloud sync unavailable', e); }
    }
  }
  start();
})();
