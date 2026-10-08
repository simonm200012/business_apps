/* Adrial Analytics: dashboard UI. Demo data comes from data.js (window.AA). No network, no libraries. */
(function () {
  'use strict';
  const A = window.AA;
  const { LOCS, CATS, CHANNELS, SOURCES, COMBOS, NC, NM, S, OPS, FUN, NSRC } = A;
  const NST = A.STORES.length, NE = A.ESHOPS.length;
  const STORE_POS = {}, ESHOP_POS = {};
  A.STORES.forEach((li, i) => { STORE_POS[li] = i; });
  A.ESHOPS.forEach((li, i) => { ESHOP_POS[li] = i; });
  const CCAT = Int8Array.from(COMBOS.map(c => c.cat)), CCH = Int8Array.from(COMBOS.map(c => c.ch)), CLOC = Int8Array.from(COMBOS.map(c => c.loc));
  const LS = 'adrial-analytics-';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = v => typeof v === 'number' && isFinite(v);
  const div = (a, b) => (b ? a / b : NaN);
  const sum = arr => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s; };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

  // ── Formatting ───────────────────────────────────────────────────────────────
  const NF = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MINUS = '−';
  const fmt = {
    eur: v => fin(v) ? (v < 0 ? MINUS : '') + '€' + NF.format(Math.abs(Math.round(v))) : '—',
    eur2: v => fin(v) ? (v < 0 ? MINUS : '') + '€' + NF2.format(Math.abs(v)) : '—',
    eurK: v => {
      if (!fin(v)) return '—';
      const a = Math.abs(v), s = v < 0 ? MINUS : '';
      if (a >= 1e6) return s + '€' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
      if (a >= 1e4) return s + '€' + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
      return s + '€' + NF.format(Math.round(a));
    },
    int: v => fin(v) ? NF.format(Math.round(v)) : '—',
    intK: v => {
      if (!fin(v)) return '—';
      const a = Math.abs(v);
      if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
      return NF.format(Math.round(v));
    },
    pct: v => fin(v) ? NF1.format(v * 100) + '%' : '—',
    pct2: v => fin(v) ? NF2.format(v * 100) + '%' : '—',
    pct0: v => fin(v) ? Math.round(v * 100) + '%' : '—',
    x: v => fin(v) ? NF2.format(v) + '×' : '—',
    num1: v => fin(v) ? NF1.format(v) : '—',
    num2: v => fin(v) ? NF2.format(v) : '—'
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dParts(dn) { const d = A.dateOf(dn); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; }
  function dLabel(dn, year = true) { const p = dParts(dn); return p.d + ' ' + MON[p.m] + (year ? ' ' + p.y : ''); }
  function rangeLabel(a, b) {
    if (a === b) return dLabel(a);
    const pa = dParts(a), pb = dParts(b);
    return dLabel(a, pa.y !== pb.y) + ' – ' + dLabel(b);
  }
  function parseIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return NaN;
    const dn = A.dnOf(+m[1], +m[2] - 1, +m[3]);
    return A.iso(dn) === s ? dn : NaN;
  }
  function shiftYear(dn, k) { const p = dParts(dn), y = p.y + k; return A.dnOf(y, p.m, Math.min(p.d, A.daysInMonth(y, p.m))); }

  // ── State & URL ─────────────────────────────────────────────────────────────
  const PRESETS = [['l7', 'Last 7 days'], ['l30', 'Last 30 days'], ['l90', 'Last 90 days'], ['tm', 'This month'], ['lm', 'Last month'],
    ['qtd', 'Quarter to date'], ['ytd', 'Year to date'], ['l12m', 'Last 12 months'], ['custom', 'Custom range']];
  const PAGES = [['overview', 'Overview'], ['stores', 'Stores'], ['ecommerce', 'E-commerce & marketing'], ['customers', 'Customers'], ['products', 'Products'],
    ['targets', 'Targets & forecast'], ['alerts', 'Alerts'], ['report', 'Monthly report'], ['live', 'ERP & CRM (live)']];
  const DEF = { r: 'l30', c: 'prev', co: 'all', l: '', ch: 'all', cat: 'all', g: 'auto', f: '', t: '', ov: 'tf', m: '', aw: '28', ak: 'all' };
  let page = 'overview', st = Object.assign({}, DEF), drawerLoc = '';
  const ui = { tables: {}, sort: lsGet('sort', {}), prodQ: '', refocus: null, exports: [], lastRender: 0 };

  function sanitize(o) {
    const x = Object.assign({}, DEF);
    if (PRESETS.some(p => p[0] === o.r)) x.r = o.r;
    if (o.c === 'prev' || o.c === 'yoy') x.c = o.c;
    if (o.co === 'SI' || o.co === 'HR') x.co = o.co;
    if (o.l) {
      const ids = [...new Set(String(o.l).split(',').filter(id => LOCS.some(L => L.id === id)))];
      x.l = ids.length && ids.length < LOCS.length ? LOCS.filter(L => ids.includes(L.id)).map(L => L.id).join(',') : '';
    }
    if (CHANNELS.some(c => c.id === o.ch)) x.ch = o.ch;
    if (CATS.some(c => c.id === o.cat)) x.cat = o.cat;
    if (['day', 'week', 'month'].includes(o.g)) x.g = o.g;
    if (['t', 'f', 'none'].includes(o.ov)) x.ov = o.ov;
    if (['56', '90'].includes(o.aw)) x.aw = o.aw;
    if (['revenue', 'returns', 'roas'].includes(o.ak)) x.ak = o.ak;
    if (/^\d{4}-\d{2}$/.test(o.m || '')) { const mi = (+o.m.slice(0, 4) - dParts(A.START).y) * 12 + (+o.m.slice(5) - 1) - dParts(A.START).m; if (mi >= 0 && mi < A.NMONTH) x.m = o.m; }
    if (x.r === 'custom') {
      let f = parseIso(o.f), t = parseIso(o.t);
      if (fin(f) && fin(t)) {
        if (f > t) { const s = f; f = t; t = s; }
        f = Math.min(Math.max(f, A.START), A.TODAY); t = Math.min(Math.max(t, A.START), A.TODAY);
        x.f = A.iso(f); x.t = A.iso(t);
      } else x.r = 'l30';
    }
    return x;
  }
  function query(o = st, s = '') {
    const parts = [];
    Object.keys(DEF).forEach(k => { if (o[k] !== DEF[k] && o[k] !== '') parts.push(k + '=' + encodeURIComponent(o[k]).replace(/%2C/g, ',')); });
    if (s) parts.push('s=' + encodeURIComponent(s));
    return parts.join('&');
  }
  function hashFor(p, s = '', o = st) { const q = query(o, s); return '#/' + p + (q ? '?' + q : ''); }
  function readHash(initial) {
    const h = location.hash.replace(/^#\/?/, '');
    const qi = h.indexOf('?');
    const p = qi >= 0 ? h.slice(0, qi) : h, q = qi >= 0 ? h.slice(qi + 1) : null;
    page = PAGES.some(x => x[0] === p) ? p : 'overview';
    if (q !== null) {
      const o = {}; new URLSearchParams(q).forEach((v, k) => { o[k] = v; });
      st = sanitize(o);
      drawerLoc = LOCS.some(L => L.id === o.s) ? o.s : '';
    } else {
      if (initial) st = sanitize(lsGet('last', {}));
      drawerLoc = '';
    }
    const want = hashFor(page, drawerLoc);
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  function setFilters(patch) {
    st = sanitize(Object.assign({}, st, patch));
    history.replaceState(null, '', hashFor(page, drawerLoc));
    lsSet('last', st);
    render();
  }

  // ── Date ranges ─────────────────────────────────────────────────────────────
  function getRange() {
    const T = A.TODAY, p = dParts(T);
    let a = T - 29, b = T;
    switch (st.r) {
      case 'l7': a = T - 6; break;
      case 'l90': a = T - 89; break;
      case 'tm': a = A.dnOf(p.y, p.m, 1); break;
      case 'lm': a = A.dnOf(p.y, p.m - 1, 1); b = A.dnOf(p.y, p.m, 0); break;
      case 'qtd': a = A.dnOf(p.y, p.m - (p.m % 3), 1); break;
      case 'ytd': a = A.dnOf(p.y, 0, 1); break;
      case 'l12m': a = shiftYear(T, -1) + 1; break;
      case 'custom': a = parseIso(st.f); b = parseIso(st.t); break;
      default: break;
    }
    a = Math.max(a, A.START); b = Math.min(Math.max(b, a), T);
    const n = b - a + 1;
    let ca, cb;
    if (st.c === 'yoy') { ca = shiftYear(a, -1); cb = shiftYear(b, -1); }
    else if (st.r === 'tm' || st.r === 'lm' || st.r === 'qtd') {
      const q = dParts(a), back = st.r === 'qtd' ? 3 : 1;
      ca = A.dnOf(q.y, q.m - back, 1);
      cb = st.r === 'lm' ? a - 1 : Math.min(ca + n - 1, a - 1);
    } else { ca = a - n; cb = a - 1; }
    const cmpOk = ca >= A.START;
    return { a, b, n, ca, cb, cn: cb - ca + 1, cmpOk, ai: a - A.START, bi: b - A.START, cai: ca - A.START, cbi: cb - A.START,
      label: (PRESETS.find(x => x[0] === st.r) || [0, ''])[1] };
  }
  const cmpName = () => st.c === 'yoy' ? 'same period last year' : 'previous period';
  const cmpShort = () => st.c === 'yoy' ? 'vs last year' : 'vs prev. period';

  // ── Selection & aggregation ─────────────────────────────────────────────────
  function selection(o = {}) {
    const set = st.l ? new Set(st.l.split(',')) : null;
    const locOk = LOCS.map(L => o.loc ? L.id === o.loc : ((st.co === 'all' || L.country === st.co) && (!set || set.has(L.id))));
    const chOk = CHANNELS.map(c => st.ch === 'all' || st.ch === c.id);
    const catOk = CATS.map(c => !!o.ignoreCat || st.cat === 'all' || st.cat === c.id);
    const combos = [];
    COMBOS.forEach((cb, i) => { if (locOk[cb.loc] && chOk[cb.ch] && catOk[cb.cat]) combos.push(i); });
    return {
      locOk, chOk, catOk, combos: Int32Array.from(combos), ignoreCat: !!o.ignoreCat,
      stores: A.STORES.filter(li => locOk[li] && chOk[0]),
      eshops: A.ESHOPS.filter(li => locOk[li] && chOk[1])
    };
  }
  const DK = ['rev', 'cogs', 'orders', 'units', 'newO', 'retRev', 'retUnits', 'eRev', 'eOrders', 'traffic', 'bookings', 'exams', 'sessions', 'views', 'atc', 'checkout', 'fOrders', 'spend'];
  function compute(ai, bi, sel) {
    const n = Math.max(0, bi - ai + 1), D = {};
    DK.forEach(k => { D[k] = new Float64Array(n); });
    const srcSess = Array.from({ length: NSRC }, () => new Float64Array(n));
    const combo = new Float64Array(NC * NM), catMonth = new Float64Array(A.NMONTH * 6 * NM);
    const locOps = new Float64Array(LOCS.length * 3), locFun = new Float64Array(LOCS.length * 3);
    const src = new Float64Array(NSRC * 7), eTmp = new Float64Array(LOCS.length);
    const cbs = sel.combos, nc = cbs.length;
    for (let i = 0; i < n; i++) {
      const d = ai + i, mi = A.dayMonth[d], row = d * NC;
      let rev = 0, cogs = 0, ord = 0, units = 0, newO = 0, retRev = 0, retU = 0, eRev = 0, eOrd = 0;
      for (let j = 0; j < nc; j++) {
        const ci = cbs[j], b = (row + ci) * NM;
        const o2 = S[b + 2];
        if (o2 === 0) continue;
        const v0 = S[b], v1 = S[b + 1], v3 = S[b + 3], v4 = S[b + 4], v5 = S[b + 5], v6 = S[b + 6];
        const o = ci * NM;
        combo[o] += v0; combo[o + 1] += v1; combo[o + 2] += o2; combo[o + 3] += v3; combo[o + 4] += v4; combo[o + 5] += v5; combo[o + 6] += v6;
        const cm = (mi * 6 + CCAT[ci]) * NM;
        catMonth[cm] += v0; catMonth[cm + 1] += v1; catMonth[cm + 2] += o2; catMonth[cm + 3] += v3; catMonth[cm + 4] += v4; catMonth[cm + 5] += v5; catMonth[cm + 6] += v6;
        rev += v0; cogs += v1; ord += o2; units += v3; newO += v4; retRev += v5; retU += v6;
        if (CCH[ci] === 1) { eRev += v0; eOrd += o2; eTmp[CLOC[ci]] += v0; }
      }
      D.rev[i] = rev; D.cogs[i] = cogs; D.orders[i] = ord; D.units[i] = units; D.newO[i] = newO; D.retRev[i] = retRev; D.retUnits[i] = retU;
      D.eRev[i] = eRev; D.eOrders[i] = eOrd;
      for (let k = 0; k < sel.stores.length; k++) {
        const li = sel.stores[k], ob = (d * NST + STORE_POS[li]) * 3;
        D.traffic[i] += OPS[ob]; D.bookings[i] += OPS[ob + 1]; D.exams[i] += OPS[ob + 2];
        locOps[li * 3] += OPS[ob]; locOps[li * 3 + 1] += OPS[ob + 1]; locOps[li * 3 + 2] += OPS[ob + 2];
      }
      for (let k = 0; k < sel.eshops.length; k++) {
        const li = sel.eshops[k], fb0 = (d * NE + ESHOP_POS[li]) * NSRC * 6;
        let tot = 0;
        for (let s = 0; s < NSRC; s++) tot += FUN[fb0 + s * 6 + 4];
        for (let s = 0; s < NSRC; s++) {
          const fb = fb0 + s * 6, so = s * 7;
          D.sessions[i] += FUN[fb]; D.views[i] += FUN[fb + 1]; D.atc[i] += FUN[fb + 2]; D.checkout[i] += FUN[fb + 3]; D.fOrders[i] += FUN[fb + 4]; D.spend[i] += FUN[fb + 5];
          srcSess[s][i] += FUN[fb];
          src[so] += FUN[fb]; src[so + 1] += FUN[fb + 1]; src[so + 2] += FUN[fb + 2]; src[so + 3] += FUN[fb + 3]; src[so + 4] += FUN[fb + 4]; src[so + 5] += FUN[fb + 5];
          if (tot > 0) src[so + 6] += eTmp[li] * FUN[fb + 4] / tot;
          locFun[li * 3] += FUN[fb]; locFun[li * 3 + 1] += FUN[fb + 4]; locFun[li * 3 + 2] += FUN[fb + 5];
        }
      }
      for (let k = 0; k < A.ESHOPS.length; k++) eTmp[A.ESHOPS[k]] = 0;
    }
    const tot = {};
    DK.forEach(k => { tot[k] = sum(D[k]); });
    return { n, D, srcSess, combo, catMonth, locOps, locFun, src, tot };
  }
  // Group combo totals: returns n arrays of the 7 sales measures.
  function group(combo, keyOf, n) {
    const out = Array.from({ length: n }, () => new Float64Array(NM));
    for (let ci = 0; ci < NC; ci++) {
      const k = keyOf(COMBOS[ci], ci);
      if (k < 0 || k == null) continue;
      for (let m = 0; m < NM; m++) out[k][m] += combo[ci * NM + m];
    }
    return out;
  }
  function kpis(t) {
    return {
      rev: t.rev, gm: div(t.rev - t.cogs, t.rev), orders: t.orders, aov: div(t.rev, t.orders), units: t.units,
      rr: div(t.retRev, t.rev), newC: t.newO, retC: t.orders - t.newO, cr: div(t.eOrders, t.sessions), roas: div(t.eRev, t.spend)
    };
  }
  const mK = g => ({ rev: g[0], cogs: g[1], orders: g[2], units: g[3], newO: g[4], retRev: g[5], retUnits: g[6] });

  // ── Buckets (day / week / month) ────────────────────────────────────────────
  function autoGran(n) { return n <= 62 ? 'day' : n <= 210 ? 'week' : 'month'; }
  function gran(n) { return st.g === 'auto' ? autoGran(n) : st.g; }
  function makeBuckets(ai, n, g) {
    const B = [], of = new Int32Array(n);
    let cur = null;
    const multiYear = dParts(A.START + ai).y !== dParts(A.START + ai + n - 1).y;
    for (let i = 0; i < n; i++) {
      const dn = A.START + ai + i;
      let key;
      if (g === 'day') key = dn;
      else if (g === 'week') key = dn - ((dParts(dn).wd + 6) % 7);
      else { const pp = dParts(dn); key = pp.y * 12 + pp.m; }
      if (!cur || cur.key !== key) { cur = { key, i0: i, i1: i, dn }; B.push(cur); } else cur.i1 = i;
      of[i] = B.length - 1;
    }
    B.forEach(b => {
      const a = A.START + ai + b.i0, e = A.START + ai + b.i1, p = dParts(a);
      if (g === 'day') { b.full = WD[p.wd] + ' ' + dLabel(a); b.short = p.d + ' ' + MON[p.m]; }
      else if (g === 'week') { b.full = 'Week ' + rangeLabel(a, e); b.short = p.d + ' ' + MON[p.m]; }
      else { b.full = MONL[p.m] + ' ' + p.y + (b.i1 - b.i0 + 1 < A.daysInMonth(p.y, p.m) ? ' (' + rangeLabel(a, e) + ')' : ''); b.short = MON[p.m] + (multiYear ? ' ' + String(p.y).slice(2) : ''); }
    });
    B.of = of; B.g = g; B.ai = ai; B.n = n;
    return B;
  }
  function sumB(arr, B) { const o = new Float64Array(B.length); for (let i = 0; i < B.n; i++) o[B.of[i]] += arr[i]; return o; }
  // Comparison days align to current days by position (day j of the comparison ↔ day j of the current range).
  function sumBc(arr, B) {
    const o = new Float64Array(B.length).fill(NaN), seen = new Uint8Array(B.length);
    for (let j = 0; j < arr.length; j++) { const b = B.of[Math.min(j, B.n - 1)]; if (!seen[b]) { o[b] = 0; seen[b] = 1; } o[b] += arr[j]; }
    return o;
  }
  function bucketTotals(D, B, cmp) {
    const o = {};
    DK.forEach(k => { o[k] = cmp ? sumBc(D[k], B) : sumB(D[k], B); });
    return B.map((_, j) => { const t = {}; DK.forEach(k => { t[k] = o[k][j]; }); return t; });
  }
  function cmpBucketLabel(R, b) {
    if (!R.cmpOk || b.i0 >= R.cn) return '';
    return rangeLabel(R.ca + b.i0, R.ca + Math.min(b.i1, R.cn - 1));
  }
  function promosIn(ai, i0, i1) {
    const a = A.START + ai + i0, b = A.START + ai + i1, names = [];
    A.PROMOS.forEach(p => { if (p.a <= b && p.b >= a && !names.includes(p.name)) names.push(p.name); });
    return names;
  }

  // ── Deltas ──────────────────────────────────────────────────────────────────
  function delta(cur, prev, type = 'rel', inverse = false) {
    if (!fin(cur) || !fin(prev)) return { txt: '—', cls: 'flat', sr: 'no comparison' };
    let d, txt;
    if (type === 'pp') { d = (cur - prev) * 100; txt = (d >= 0 ? '+' : MINUS) + NF1.format(Math.abs(d)) + ' pp'; }
    else { if (prev === 0) return { txt: '—', cls: 'flat', sr: 'no comparison' }; d = (cur - prev) / Math.abs(prev); txt = (d >= 0 ? '▲ ' : '▼ ') + NF1.format(Math.abs(d * 100)) + '%'; }
    const flat = type === 'pp' ? Math.abs(d) < 0.05 : Math.abs(d) < 0.0005;
    const good = inverse ? d < 0 : d > 0;
    return { txt, cls: flat ? 'flat' : good ? 'good' : 'bad', d, sr: (d >= 0 ? 'up ' : 'down ') + txt.replace(/[▲▼+−]\s?/, '') };
  }
  function deltaHtml(cur, prev, type, inverse) {
    const x = delta(cur, prev, type, inverse);
    return `<span class="delta ${x.cls}" aria-label="${esc(x.sr)}">${esc(x.txt)}</span>`;
  }
  function trendArrow(cur, prev) {
    const x = delta(cur, prev);
    if (!fin(x.d)) return '<span class="delta flat">—</span>';
    const arrow = Math.abs(x.d) < 0.01 ? '→' : x.d > 0 ? '↗' : '↘';
    return `<span class="delta ${Math.abs(x.d) < 0.01 ? 'flat' : x.cls}" aria-label="${esc(x.sr)}"><span aria-hidden="true">${arrow}</span> ${esc(x.txt.replace(/[▲▼]\s?/, ''))}</span>`;
  }

  // ── Tooltip & chart framework ───────────────────────────────────────────────
  const tip = $('tip'), live = $('live');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let L = x + 14, T = y - r.height - 10;
    if (L + r.width > innerWidth - 8) L = x - r.width - 14;
    if (L < 8) L = 8;
    if (T < 8) T = y + 18;
    if (T + r.height > innerHeight - 8) T = innerHeight - r.height - 8;
    tip.style.left = L + 'px'; tip.style.top = T + 'px';
  }
  function hideTip() { tip.hidden = true; }
  const textOf = html => { const d = document.createElement('div'); d.innerHTML = html.replace(/<br\s*\/?>/g, '. '); return d.textContent; };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    entries.forEach(e => {
      const h = e.target, w = Math.floor(e.contentRect.width);
      if (w > 0 && w !== h._w && !h._raf) h._raf = requestAnimationFrame(() => { h._raf = 0; drawChart(h); });
    });
  }) : null;
  function mount(id, draw) {
    const h = $(id);
    if (!h) return;
    h._draw = draw;
    drawChart(h);
    if (ro) ro.observe(h);
  }
  function drawChart(h) {
    if (!h.isConnected || !h._draw) return;
    const w = Math.floor(h.clientWidth);
    if (w <= 0) return;
    h._w = w;
    try {
      const out = h._draw(Math.max(220, w));
      h.innerHTML = out.svg;
      bindChart(h, out);
    } catch (err) {
      h.innerHTML = '<p class="empty">Chart could not be drawn.</p>';
      if (window.console) console.warn(err);
    }
  }
  function redrawAll() { document.querySelectorAll('.chart').forEach(h => { if (h._draw) drawChart(h); }); }
  function bindChart(h, out) {
    const svg = h.querySelector('svg');
    const items = out.items || [];
    if (!svg || !items.length) return;
    let idx = -1;
    const pos = it => { const r = svg.getBoundingClientRect(), k = r.width / out.w; return [r.left + it.x * k, r.top + it.y * k]; };
    function clearHi() {
      const cur = svg.querySelector('.cur');
      if (cur) cur.innerHTML = '';
      svg.querySelectorAll('.hot').forEach(e => e.classList.remove('hot'));
    }
    function act(i, kb) {
      if (i < 0 || i >= items.length) return;
      idx = i;
      const it = items[i];
      clearHi();
      if (out.mode === 'x') {
        const cur = svg.querySelector('.cur');
        if (cur) cur.innerHTML = `<line x1="${it.x}" x2="${it.x}" y1="${out.top}" y2="${out.bottom}" class="cline"/>` +
          it.dots.map(d => `<circle cx="${it.x}" cy="${d.y}" r="4.5" style="fill:${d.c};stroke:var(--surface);stroke-width:2"/>`).join('');
      } else svg.querySelectorAll(`[data-i="${i}"]`).forEach(e => e.classList.add('hot'));
      const p = pos(it);
      showTip(it.tip, p[0], p[1]);
      if (kb) live.textContent = textOf(it.tip);
    }
    function leave() { clearHi(); hideTip(); }
    function pick(e) {
      if (out.mode === 'x') {
        const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * out.w / r.width;
        let best = 0, bd = Infinity;
        for (let i = 0; i < items.length; i++) { const dd = Math.abs(items[i].x - x); if (dd < bd) { bd = dd; best = i; } }
        return best;
      }
      const t = e.target.closest && e.target.closest('[data-i]');
      return t ? +t.getAttribute('data-i') : -1;
    }
    svg.addEventListener('pointermove', e => { const i = pick(e); if (i < 0) leave(); else if (i !== idx || tip.hidden) act(i); });
    svg.addEventListener('pointerdown', e => { const i = pick(e); if (i >= 0) act(i); });
    svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) leave(); });
    svg.addEventListener('click', e => { const i = pick(e); if (i >= 0 && items[i].onClick) items[i].onClick(); });
    svg.addEventListener('focus', () => act(idx >= 0 ? idx : 0, true));
    svg._refresh = () => { if (idx >= 0) act(idx, false); };
    svg.addEventListener('blur', leave);
    svg.addEventListener('keydown', e => {
      const n = items.length, cols = out.cols || 0;
      let i = idx < 0 ? 0 : idx;
      if (e.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
      else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
      else if (e.key === 'ArrowDown') i = cols ? Math.min(n - 1, i + cols) : Math.min(n - 1, i + 1);
      else if (e.key === 'ArrowUp') i = cols ? Math.max(0, i - cols) : Math.max(0, i - 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if ((e.key === 'Enter' || e.key === ' ') && items[i] && items[i].onClick) { e.preventDefault(); items[i].onClick(); return; }
      else if (e.key === 'Escape') { leave(); return; }
      else return;
      e.preventDefault();
      act(i, true);
    });
  }
  function svgOpen(w, h, label) {
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" tabindex="0" aria-label="${esc(label)}" aria-describedby="chartHint">`;
  }
  function niceScale(v, ticks = 4) {
    if (!(v > 0)) return { max: 1, step: 0.25 };
    const raw = v / ticks, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    const nm = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    const step = nm * p;
    return { max: Math.ceil(v / step - 1e-9) * step, step };
  }
  const tw = (s, px = 10) => String(s).length * px * 0.62;
  function trunc(s, px, maxW) { s = String(s); if (tw(s, px) <= maxW) return s; const n = Math.max(1, Math.floor(maxW / (px * 0.62)) - 1); return s.slice(0, n) + '…'; }
  const f1 = v => Math.round(v * 10) / 10;

  // Line chart (one or more series over buckets). mode 'x': nearest bucket under the pointer.
  function lineChart(o) {
    const w = o.w, h = o.h || 250, n = o.labels.length;
    let vmax = 0;
    o.series.forEach(s => { s.vals.forEach(v => { if (fin(v) && v > vmax) vmax = v; }); if (s.band) s.band.hi.forEach(v => { if (fin(v) && v > vmax) vmax = v; }); });
    const sc = niceScale(vmax), ticks = [];
    for (let v = 0; v <= sc.max + sc.step / 2; v += sc.step) ticks.push(v);
    const L = Math.max(34, Math.max(...ticks.map(t => tw(o.fmtY(t)))) + 12), R = 14, T = 12, Bm = 26;
    const pw = w - L - R, ph = h - T - Bm;
    const X = i => L + (n <= 1 ? pw / 2 : i * pw / (n - 1)), Y = v => T + ph - (v / sc.max) * ph;
    let g = '';
    if (o.bands) o.bands.forEach(i => { const sw = n <= 1 ? pw : pw / (n - 1), x0 = Math.max(L, X(i) - sw / 2), x1 = Math.min(L + pw, X(i) + sw / 2); g += `<rect class="band" x="${f1(x0)}" y="${T}" width="${f1(Math.max(1, x1 - x0))}" height="${ph}"/>`; });
    ticks.forEach(t => { const y = f1(Y(t)); g += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" class="gl${t === 0 ? ' base' : ''}"/><text x="${L - 8}" y="${y + 3}" class="axis" text-anchor="end">${esc(o.fmtY(t))}</text>`; });
    const lw = Math.max(...o.labels.map(s => tw(s))) + 14, maxLab = Math.max(2, Math.floor(pw / lw)), step = Math.max(1, Math.ceil(n / maxLab));
    for (let i = 0; i < n; i += step) {
      const anchor = n === 1 ? 'middle' : (i === 0 ? 'start' : (X(i) + lw / 2 > w ? 'end' : 'middle'));
      g += `<text x="${f1(X(i))}" y="${h - 8}" class="axis" text-anchor="${anchor}">${esc(o.labels[i])}</text>`;
    }
    let paths = '';
    if (o.marker != null && o.marker >= 0 && o.marker < n) {
      const mx = f1(X(o.marker));
      g += `<line x1="${mx}" x2="${mx}" y1="${T}" y2="${T + ph}" class="ref"/><text x="${mx + 4}" y="${T + 10}" class="axis">${esc(o.markerLabel || '')}</text>`;
    }
    o.series.forEach(s => {
      if (!s.band) return;
      let seg = [];
      const flush = () => {
        if (seg.length > 1) paths += `<path d="${seg.map((i, k) => (k ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y(s.band.hi[i]))).join(' ')} ${seg.slice().reverse().map(i => 'L' + f1(X(i)) + ' ' + f1(Y(s.band.lo[i]))).join(' ')}Z" style="fill:${s.color};fill-opacity:.13;stroke:none"/>`;
        seg = [];
      };
      for (let i = 0; i < n; i++) { if (fin(s.band.lo[i]) && fin(s.band.hi[i])) seg.push(i); else flush(); }
      flush();
    });
    o.series.slice().reverse().forEach(s => {
      let d = '', pen = false, first = -1, last = -1;
      s.vals.forEach((v, i) => { if (!fin(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + f1(X(i)) + ' ' + f1(Y(v)); pen = true; if (first < 0) first = i; last = i; });
      if (s.area && first >= 0 && last > first) paths += `<path d="${d} L${f1(X(last))} ${f1(Y(0))} L${f1(X(first))} ${f1(Y(0))}Z" style="fill:${s.color};fill-opacity:.09;stroke:none"/>`;
      paths += `<path d="${d}" class="ln" style="stroke:${s.color};stroke-width:${s.width || 2}${s.dash ? ';stroke-dasharray:' + (s.dash === true ? '5 4' : s.dash) : ''}"/>`;
      if (n <= 2 || (first === last && first >= 0)) s.vals.forEach((v, i) => { if (fin(v)) paths += `<circle cx="${f1(X(i))}" cy="${f1(Y(v))}" r="3.5" style="fill:${s.color}"/>`; });
    });
    const items = o.labels.map((_, i) => {
      const dots = o.series.filter(s => fin(s.vals[i])).map(s => ({ y: f1(Y(s.vals[i])), c: s.color }));
      return { x: f1(X(i)), y: dots.length ? Math.min(...dots.map(d => d.y)) : T, dots, tip: o.tips(i) };
    });
    const svg = svgOpen(w, h, o.aria) + g + paths + `<g class="cur"></g><rect class="hitarea" x="${L}" y="${T}" width="${pw}" height="${ph}"/></svg>`;
    return { svg, items, mode: 'x', w, top: T, bottom: T + ph };
  }

  // Horizontal bars, one value per row (optionally a sub-label under the label).
  function hbarChart(o) {
    const w = o.w, rows = o.rows, rh = o.rowH || (rows.some(r => r.sub) ? 44 : 32);
    const h = Math.max(rh, rows.length * rh) + 4;
    const vals = rows.map(r => r.value), max = o.max || Math.max(0, ...vals.filter(fin)) || 1;
    const vlab = rows.map(r => r.valueLabel != null ? r.valueLabel : o.fmt(r.value));
    const labW = Math.min(Math.max(70, Math.max(...rows.map(r => Math.max(tw(r.label, 12.5), r.sub ? tw(r.sub, 10) : 0))) + 14), w * 0.42);
    const valW = Math.max(...vlab.map(s => tw(s, 11))) + 12;
    const bw = Math.max(20, w - labW - valW);
    let g = '';
    const items = [];
    rows.forEach((r, i) => {
      const y = i * rh + 2, cy = y + rh / 2, bh = o.barH || 10;
      const by = r.sub ? cy - bh / 2 : cy - bh / 2;
      const len = fin(r.value) && r.value > 0 ? Math.max(2, r.value / max * bw) : 0;
      g += `<g data-i="${i}" class="row${r.onClick ? ' click' : ''}"><rect class="hitrow" x="0" y="${y}" width="${w}" height="${rh}"/>`;
      g += r.sub
        ? `<text x="0" y="${cy - 3}" class="lab">${esc(trunc(r.label, 12.5, labW - 10))}</text><text x="0" y="${cy + 11}" class="sublab">${esc(trunc(r.sub, 10, labW - 10))}</text>`
        : `<text x="0" y="${cy + 4}" class="lab">${esc(trunc(r.label, 12.5, labW - 10))}</text>`;
      g += `<rect x="${labW}" y="${f1(by)}" width="${f1(bw)}" height="${bh}" rx="${bh / 2}" class="trk"/>`;
      if (len) g += `<rect x="${labW}" y="${f1(by)}" width="${f1(len)}" height="${bh}" rx="3" class="bar" style="fill:${r.color || 'var(--accent)'}"/>`;
      g += `<text x="${w}" y="${cy + 4}" class="val" text-anchor="end">${esc(vlab[i])}</text></g>`;
      items.push({ x: labW + len, y: by, tip: r.tip, onClick: r.onClick });
    });
    return { svg: svgOpen(w, h, o.aria) + g + '</svg>', items, mode: 'el', w };
  }

  // Grouped horizontal bars: rows × series. perRow: scale each row to its own max (mixed units).
  function groupBars(o) {
    const w = o.w, ns = o.series.length, bh = 9, gap = 3, rh = ns * (bh + gap) + 18;
    const h = o.rows.length * rh + 4;
    const labW = Math.min(Math.max(70, Math.max(...o.rows.map(r => tw(r.label, 12.5))) + 14), w * 0.34);
    const fmtOf = r => r.fmt || o.fmt;
    const valW = Math.max(...o.rows.map(r => Math.max(...r.vals.map(v => tw(fmtOf(r)(v), 11))))) + 12;
    const bw = Math.max(20, w - labW - valW);
    const gmax = Math.max(0, ...o.rows.flatMap(r => r.vals.filter(fin))) || 1;
    let g = '';
    const items = [];
    o.rows.forEach((r, i) => {
      const y = i * rh + 2, max = o.perRow ? (Math.max(0, ...r.vals.filter(fin)) || 1) : gmax;
      const top = y + (rh - ns * (bh + gap) + gap) / 2;
      g += `<g data-i="${i}" class="row"><rect class="hitrow" x="0" y="${y}" width="${w}" height="${rh}"/><text x="0" y="${y + rh / 2 + 4}" class="lab">${esc(trunc(r.label, 12.5, labW - 10))}</text>`;
      r.vals.forEach((v, s) => {
        const by = top + s * (bh + gap), len = fin(v) && v > 0 ? Math.max(2, v / max * bw) : 0;
        if (len) g += `<rect x="${labW}" y="${f1(by)}" width="${f1(len)}" height="${bh}" rx="3" class="bar" style="fill:${o.series[s].color}"/>`;
        g += `<text x="${f1(labW + len + 6)}" y="${f1(by + bh - 1)}" class="val sm">${esc(fmtOf(r)(v))}</text>`;
      });
      g += '</g>';
      items.push({ x: labW + bw * 0.5, y: top, tip: r.tip });
    });
    return { svg: svgOpen(w, h, o.aria) + g + '</svg>', items, mode: 'el', w };
  }

  // Vertical stacked bars over buckets.
  function stackChart(o) {
    const w = o.w, h = o.h || 240, n = o.labels.length;
    const totals = o.labels.map((_, i) => o.series.reduce((a, s) => a + (fin(s.vals[i]) ? s.vals[i] : 0), 0));
    const sc = niceScale(Math.max(0, ...totals)), ticks = [];
    for (let v = 0; v <= sc.max + sc.step / 2; v += sc.step) ticks.push(v);
    const L = Math.max(34, Math.max(...ticks.map(t => tw(o.fmtY(t)))) + 12), R = 8, T = 12, Bm = 26;
    const pw = w - L - R, ph = h - T - Bm, slot = pw / Math.max(1, n), bw = Math.max(1, Math.min(44, slot * 0.72));
    const Y = v => T + ph - (v / sc.max) * ph;
    let g = '';
    ticks.forEach(t => { const y = f1(Y(t)); g += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" class="gl${t === 0 ? ' base' : ''}"/><text x="${L - 8}" y="${y + 3}" class="axis" text-anchor="end">${esc(o.fmtY(t))}</text>`; });
    const lw = Math.max(...o.labels.map(s => tw(s))) + 12, step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / lw))));
    for (let i = 0; i < n; i += step) g += `<text x="${f1(L + slot * (i + 0.5))}" y="${h - 8}" class="axis" text-anchor="middle">${esc(o.labels[i])}</text>`;
    const items = [];
    for (let i = 0; i < n; i++) {
      const x = L + slot * i + (slot - bw) / 2;
      let acc = 0, segs = '';
      o.series.forEach(s => {
        const v = fin(s.vals[i]) ? s.vals[i] : 0;
        if (v <= 0) return;
        const y0 = Y(acc), y1 = Y(acc + v);
        segs += `<rect x="${f1(x)}" y="${f1(y1)}" width="${f1(bw)}" height="${f1(Math.max(0.5, y0 - y1))}" class="seg" style="fill:${s.color}"/>`;
        acc += v;
      });
      g += `<g data-i="${i}" class="col"><rect class="hitrow" x="${f1(L + slot * i)}" y="${T}" width="${f1(slot)}" height="${ph}"/>${segs}</g>`;
      items.push({ x: f1(x + bw / 2), y: f1(Y(acc)), tip: o.tips(i) });
    }
    return { svg: svgOpen(w, h, o.aria) + g + '</svg>', items, mode: 'el', w };
  }

  // Donut with centre total.
  function donutChart(o) {
    const w = o.w, size = Math.min(w, o.size || 220), h = size, cx = w / 2, cy = size / 2, R = size / 2 - 4, r = R * 0.62;
    const total = o.items.reduce((a, it) => a + Math.max(0, it.value || 0), 0);
    let g = '', ang = -Math.PI / 2;
    const items = [];
    const pt = (rad, a) => f1(cx + rad * Math.cos(a)) + ' ' + f1(cy + rad * Math.sin(a));
    if (!(total > 0)) g += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" style="fill:none;stroke:var(--track);stroke-width:${R - r}"/>`;
    o.items.forEach((it, i) => {
      const v = Math.max(0, it.value || 0);
      if (!(total > 0) || v <= 0) return;
      const frac = v / total, a0 = ang, a1 = ang + frac * Math.PI * 2;
      ang = a1;
      let d;
      if (frac > 0.9999) {
        const m = a0 + Math.PI;
        d = `M${pt(R, a0)} A${R} ${R} 0 1 1 ${pt(R, m)} A${R} ${R} 0 1 1 ${pt(R, a0)} L${pt(r, a0)} A${r} ${r} 0 1 0 ${pt(r, m)} A${r} ${r} 0 1 0 ${pt(r, a0)}Z`;
      } else {
        const large = a1 - a0 > Math.PI ? 1 : 0;
        d = `M${pt(R, a0)} A${R} ${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r, a1)} A${r} ${r} 0 ${large} 0 ${pt(r, a0)}Z`;
      }
      const mid = (a0 + a1) / 2;
      g += `<path d="${d}" data-i="${items.length}" class="arc" style="fill:${it.color}"/>`;
      items.push({ x: f1(cx + (R + r) / 2 * Math.cos(mid)), y: f1(cy + (R + r) / 2 * Math.sin(mid)), tip: it.tip });
    });
    g += `<text x="${cx}" y="${cy - 2}" class="dtot" text-anchor="middle">${esc(o.center)}</text><text x="${cx}" y="${cy + 16}" class="axis" text-anchor="middle">${esc(o.centerSub || '')}</text>`;
    return { svg: svgOpen(w, h, o.aria) + g + '</svg>', items, mode: 'el', w };
  }

  // Cohort heatmap: rows = cohorts, cols = months since first purchase. Null cells are not reached yet.
  function heatmap(o) {
    const w = o.w, nc = o.cols.length, labW = w < 480 ? 58 : 128, top = 22, cw = (w - labW) / nc, chh = Math.max(22, Math.min(30, cw * 0.8));
    const h = top + o.rows.length * chh + 2;
    let vmax = 0;
    o.rows.forEach(r => r.cells.forEach((v, c) => { if (c > 0 && fin(v) && v > vmax) vmax = v; }));
    let g = '';
    o.cols.forEach((c, j) => { if (cw >= 22 || j % 2 === 0) g += `<text x="${f1(labW + cw * j + cw / 2)}" y="14" class="axis" text-anchor="middle">${esc(c)}</text>`; });
    const items = [];
    o.rows.forEach((r, i) => {
      const y = top + i * chh;
      g += `<text x="0" y="${f1(y + chh / 2 + 4)}" class="lab sm">${esc(w < 480 ? r.short : r.label)}</text>`;
      r.cells.forEach((v, j) => {
        const x = labW + j * cw, id = items.length;
        let fill = 'var(--sunken)', txt = '', tc = 'var(--ink3)';
        if (fin(v)) {
          if (j === 0) { fill = 'var(--fill)'; tc = 'var(--ink2)'; }
          else { const k = vmax ? v / vmax : 0, pct = Math.round(10 + 80 * k); fill = `color-mix(in srgb, var(--accent) ${pct}%, var(--surface))`; tc = pct > 52 ? 'var(--surface)' : 'var(--ink)'; }
          txt = cw >= 40 ? Math.round(v * 100) + '%' : cw >= 24 ? String(Math.round(v * 100)) : '';
        }
        g += `<g data-i="${id}" class="cell"><rect x="${f1(x + 1)}" y="${f1(y + 1)}" width="${f1(cw - 2)}" height="${f1(chh - 2)}" rx="4" style="fill:${fill}"/>` +
          (txt ? `<text x="${f1(x + cw / 2)}" y="${f1(y + chh / 2 + 3.5)}" class="ctext" text-anchor="middle" style="fill:${tc}">${txt}</text>` : '') + '</g>';
        items.push({ x: f1(x + cw / 2), y: f1(y), tip: o.tips(i, j) });
      });
    });
    return { svg: svgOpen(w, h, o.aria) + g + '</svg>', items, mode: 'el', w, cols: nc };
  }

  // Pareto staircase: each product is a block from the previous cumulative share to its own.
  function paretoChart(o) {
    const w = o.w, h = o.h || 260, n = o.items.length;
    const L = 40, R = 10, T = 12, Bm = 28, pw = w - L - R, ph = h - T - Bm, slot = pw / Math.max(1, n);
    const Y = v => T + ph - v * ph;
    let g = '';
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(t => { g += `<line x1="${L}" x2="${w - R}" y1="${f1(Y(t))}" y2="${f1(Y(t))}" class="gl${t === 0 ? ' base' : ''}"/><text x="${L - 8}" y="${f1(Y(t)) + 3}" class="axis" text-anchor="end">${t * 100}%</text>`; });
    [[0.8, 'A · 80%'], [0.95, 'B · 95%']].forEach(([v, l]) => { g += `<line x1="${L}" x2="${w - R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" class="ref"/><text x="${w - R - 4}" y="${f1(Y(v)) - 4}" class="axis" text-anchor="end">${l}</text>`; });
    const items = [];
    let line = `M${L} ${f1(Y(0))}`;
    o.items.forEach((it, i) => {
      const x = L + i * slot, y0 = Y(it.prev), y1 = Y(it.cum);
      g += `<g data-i="${i}" class="col"><rect class="hitrow" x="${f1(x)}" y="${T}" width="${f1(slot)}" height="${ph}"/><rect x="${f1(x + (slot > 4 ? 1 : 0))}" y="${f1(y1)}" width="${f1(Math.max(0.6, slot - (slot > 4 ? 2 : 0)))}" height="${f1(Math.max(0.8, y0 - y1))}" rx="${slot > 6 ? 2 : 0}" class="bar" style="fill:${it.color}"/></g>`;
      line += ` L${f1(x + slot)} ${f1(y1)}`;
      items.push({ x: f1(x + slot / 2), y: f1(y1), tip: it.tip });
    });
    g += `<path d="${line}" class="ln" style="stroke:var(--ink2);stroke-width:1.5"/>`;
    g += `<text x="${L}" y="${h - 8}" class="axis">Products ranked by revenue →</text><text x="${w - R}" y="${h - 8}" class="axis" text-anchor="end">${n} products</text>`;
    return { svg: svgOpen(w, h, o.aria) + g + '</svg>', items, mode: 'el', w };
  }

  // Map-ish bubble chart: stores at approximate coordinates, e-shops in an "Online" column.
  const BORDER = [[13.59, 45.48], [13.98, 45.45], [14.35, 45.47], [14.6, 45.63], [15.0, 45.49], [15.3, 45.7], [15.4, 45.84], [15.7, 45.85], [15.65, 46.2], [16.0, 46.27], [16.3, 46.37], [16.6, 46.48]];
  function bubbleMap(o) {
    const w = o.w, online = w < 460 ? 96 : 140, mw = w - online, lon0 = 13.2, lon1 = 19.1, lat0 = 43.2, lat1 = 46.9, k = Math.cos(45 * Math.PI / 180);
    const scale = Math.min((mw - 20) / ((lon1 - lon0) * k), 420 / (lat1 - lat0)), h = Math.max(220, Math.round((lat1 - lat0) * scale + 20));
    const X = lon => 10 + (lon - lon0) * k * scale, Y = lat => 10 + (lat1 - lat) * scale;
    const vmax = Math.max(1, ...o.points.map(p => p.value || 0));
    const rad = v => 5 + 22 * Math.sqrt(Math.max(0, v) / vmax) * Math.min(1, w / 700 + 0.3);
    let g = `<path d="${BORDER.map((p, i) => (i ? 'L' : 'M') + f1(X(p[0])) + ' ' + f1(Y(p[1]))).join(' ')}" class="border"/>`;
    g += `<text x="${f1(X(14.2))}" y="${f1(Y(46.75))}" class="axis">SLOVENIA</text><text x="${f1(X(16.6))}" y="${f1(Y(44.6))}" class="axis">CROATIA</text>`;
    g += `<line x1="${mw}" x2="${mw}" y1="10" y2="${h - 10}" class="gl"/><text x="${mw + online / 2}" y="22" class="axis" text-anchor="middle">ONLINE</text>`;
    const items = [];
    const pts = o.points.slice().sort((a, b) => (b.value || 0) - (a.value || 0));
    let oi = 0;
    pts.forEach(p => {
      let x, y;
      if (p.online) { x = mw + online / 2; y = 70 + oi * Math.min(110, (h - 80) / 2); oi++; } else { x = X(p.lon); y = Y(p.lat); }
      const r = p.active ? rad(p.value) : 4;
      const id = items.length;
      g += `<g data-i="${id}" class="bub${p.onClick ? ' click' : ''}">` +
        (p.active ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" style="fill:${p.color};fill-opacity:.82;stroke:var(--surface);stroke-width:2"/>`
          : `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" style="fill:none;stroke:var(--dash);stroke-width:1.5"/>`) +
        `<text x="${f1(p.online ? x : p.left ? x - r - 4 : x + r + 4)}" y="${f1(p.online ? y + r + 13 : y + 3.5)}" class="lab sm" ${p.online ? 'text-anchor="middle"' : p.left ? 'text-anchor="end"' : ''}>${esc(p.label)}</text></g>`;
      items.push({ x: f1(x), y: f1(y - r), tip: p.tip, onClick: p.onClick });
    });
    return { svg: svgOpen(w, h, o.aria) + g + '</svg>', items, mode: 'el', w };
  }

  function sparkline(vals, color) {
    const v = vals.filter(fin);
    if (v.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
    const W = 100, H = 30, min = Math.min(...v), max = Math.max(...v), span = max - min || 1, n = vals.length;
    let d = '', pen = false;
    vals.forEach((x, i) => { if (!fin(x)) { pen = false; return; } d += (pen ? 'L' : 'M') + f1(i / (n - 1) * W) + ' ' + f1(H - 3 - (x - min) / span * (H - 6)); pen = true; });
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${d}" style="fill:none;stroke:${color};stroke-width:1.6;vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round"/></svg>`;
  }

  // ── Tables, cards, export registry ──────────────────────────────────────────
  const TYPES = {
    eur: { f: fmt.eur, csv: v => fin(v) ? v.toFixed(2) : '', r: 1 },
    eur2: { f: fmt.eur2, csv: v => fin(v) ? v.toFixed(2) : '', r: 1 },
    int: { f: fmt.int, csv: v => fin(v) ? String(Math.round(v)) : '', r: 1 },
    pct: { f: fmt.pct, csv: v => fin(v) ? (v * 100).toFixed(2) : '', r: 1, unit: ' (%)' },
    pct2: { f: fmt.pct2, csv: v => fin(v) ? (v * 100).toFixed(2) : '', r: 1, unit: ' (%)' },
    x: { f: fmt.x, csv: v => fin(v) ? v.toFixed(2) : '', r: 1 },
    num: { f: fmt.num2, csv: v => fin(v) ? v.toFixed(2) : '', r: 1 },
    chg: { f: v => fin(v) ? trendArrow(1 + v, 1) : '<span class="delta flat">—</span>', html: 1, csv: v => fin(v) ? (v * 100).toFixed(2) : '', r: 1, unit: ' (%)' },
    txt: { f: v => esc(v), csv: v => v == null ? '' : String(v) }
  };
  const chg = (c, p) => (fin(c) && fin(p) && p !== 0) ? (c - p) / Math.abs(p) : NaN;
  function tableHtml(t, tid) {
    let rows = t.rows.slice();
    const s = t.sortable && ui.sort[tid];
    if (s && t.cols[s.c]) {
      const c = s.c;
      rows.sort((a, b) => {
        const x = a.v[c], y = b.v[c];
        if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * s.d;
        const fx = fin(x), fy = fin(y);
        if (!fx && !fy) return 0; if (!fx) return 1; if (!fy) return -1;
        return (x - y) * s.d;
      });
    }
    const head = t.cols.map((c, j) => {
      const ty = TYPES[c.t || 'txt'], cls = ty.r ? ' class="r"' : '';
      if (!t.sortable) return `<th scope="col"${cls}>${esc(c.h)}</th>`;
      const sorted = s && s.c === j;
      return `<th scope="col"${cls}${sorted ? ` aria-sort="${s.d > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${tid}:${j}" data-d="${ty.r ? -1 : 1}">${esc(c.h)}</button></th>`;
    }).join('');
    const cell = (c, v, row) => {
      const ty = TYPES[c.t || 'txt'];
      const inner = c.render ? c.render(v, row) : ty.f(v);
      return `<td${ty.r ? ' class="r"' : ''}>${inner}</td>`;
    };
    const body = rows.map(row => `<tr${row.attr ? ' ' + row.attr : ''}>${t.cols.map((c, j) => cell(c, row.v[j], row)).join('')}</tr>`).join('');
    const footCell = (c, v) => { const ty = TYPES[c.t || 'txt']; return `<td${ty.r ? ' class="r"' : ''}>${typeof v === 'string' ? esc(v) : ty.f(v)}</td>`; };
    const foot = t.foot ? `<tfoot><tr>${t.cols.map((c, j) => footCell(c, t.foot[j])).join('')}</tr></tfoot>` : '';
    const empty = rows.length ? '' : `<tr><td colspan="${t.cols.length}" class="empty">No data for these filters.</td></tr>`;
    return `<div class="tablewrap"><table${t.caption ? ` aria-label="${esc(t.caption)}"` : ''}><thead><tr>${head}</tr></thead><tbody>${body}${empty}</tbody>${foot}</table></div>`;
  }
  function addExport(title, t) { ui.exports.push({ title, t }); }
  function card(o) {
    const id = o.id, showT = !!ui.tables[id];
    if (o.table) addExport(o.title, o.table);
    const tbtn = o.table ? `<button type="button" class="btn sm ghost tbtn" data-ttoggle="${id}" aria-pressed="${showT}" aria-controls="${id}-t">${showT ? 'View chart' : 'View as table'}</button>` : '';
    return `<section class="card ${o.cls || ''}" id="${id}"${showT ? ' data-tab="1"' : ''} aria-labelledby="${id}-h">` +
      `<header class="ch"><div class="chl">${o.eyebrow ? `<span class="label">${esc(o.eyebrow)}</span>` : ''}<h2 id="${id}-h">${esc(o.title)}</h2>${o.sub ? `<p>${o.sub}</p>` : ''}</div>` +
      `<div class="cact">${o.actions || ''}${tbtn}</div></header>` +
      `<div class="cb">${o.body || ''}${o.table ? `<div class="ctable" id="${id}-t">${tableHtml(o.table, id + '-t')}</div>` : ''}</div>` +
      (o.foot ? `<p class="cfoot">${o.foot}</p>` : '') + '</section>';
  }
  const chartDiv = (id, minH) => `<div class="chart" id="${id}"${minH ? ` style="min-height:${minH}px"` : ''}></div>`;
  const legend = items => `<div class="legend">${items.map(it => `<span><i class="${it.dash ? 'ldash' : 'dot'}" style="${it.dash ? 'border-color' : 'background'}:${it.color}"></i>${esc(it.label)}${it.value != null ? ` <b>${esc(it.value)}</b>` : ''}</span>`).join('')}</div>`;
  const emptyCard = (title, msg) => `<section class="card"><header class="ch"><div class="chl"><h2>${esc(title)}</h2></div></header><p class="empty">${esc(msg)}</p></section>`;
  const color = i => `var(--c${(i % 6) + 1})`;
  const CH_COLOR = ['var(--c1)', 'var(--c2)', 'var(--c3)'];
  const CO_COLOR = { SI: 'var(--c1)', HR: 'var(--c2)' };

  function granSeg() {
    const opts = [['auto', 'Auto'], ['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']];
    return `<div class="seg sm" role="group" aria-label="Granularity">${opts.map(o => `<button type="button" data-gran="${o[0]}" aria-pressed="${st.g === o[0]}">${o[1]}</button>`).join('')}</div>`;
  }

  // ── Shared pieces ───────────────────────────────────────────────────────────
  function kpiTiles(defs, K, KC, series, R) {
    return `<section class="kpis" aria-label="Key figures">${defs.map(d => {
      const v = K[d.k], p = KC ? KC[d.k] : NaN, sp = series ? series.map(x => x[d.k]) : [];
      const title = KC ? `${cmpName()[0].toUpperCase() + cmpName().slice(1)}: ${d.f(p)}` : 'No comparison available';
      return `<article class="kpi" title="${esc(title)}"><div class="l">${esc(d.label)}</div><div class="v">${esc(d.f(v))}</div>` +
        `<div class="d">${KC ? deltaHtml(v, p, d.type, d.inverse) : '<span class="delta flat">—</span>'}<span class="muted">${R.cmpOk ? cmpShort() : 'no comparison'}</span></div>${sparkline(sp, 'var(--accent)')}</article>`;
    }).join('')}</section>`;
  }
  const KPI_DEFS = [
    { k: 'rev', label: 'Revenue', f: fmt.eurK },
    { k: 'gm', label: 'Gross margin', f: fmt.pct, type: 'pp' },
    { k: 'orders', label: 'Orders', f: fmt.intK },
    { k: 'aov', label: 'Avg order value', f: fmt.eur2 },
    { k: 'units', label: 'Units sold', f: fmt.intK },
    { k: 'rr', label: 'Return rate', f: fmt.pct, type: 'pp', inverse: true },
    { k: 'newC', label: 'New customers', f: fmt.intK },
    { k: 'retC', label: 'Returning customers', f: fmt.intK },
    { k: 'cr', label: 'E-shop conversion', f: fmt.pct2, type: 'pp' },
    { k: 'roas', label: 'ROAS (blended)', f: fmt.x }
  ];
  function sparkBuckets(R) { const g = R.n <= 31 ? 'day' : R.n <= 120 ? 'week' : 'month'; return makeBuckets(R.ai, R.n, g); }

  // ── Months (also beyond the data window, for targets and forecasts) ─────────
  const P0 = dParts(A.START), TI = A.ND - 1, NL = LOCS.length;
  const mIdx = dn => { const p = dParts(dn); return (p.y - P0.y) * 12 + p.m - P0.m; };
  const mStart = mi => A.dnOf(P0.y, P0.m + mi, 1);
  const mEnd = mi => A.dnOf(P0.y, P0.m + mi + 1, 0);
  const mKey = mi => { const p = dParts(mStart(mi)); return p.y + '-' + String(p.m + 1).padStart(2, '0'); };
  const mName = (mi, short) => { const p = dParts(mStart(mi)); return (short ? MON : MONL)[p.m] + ' ' + p.y; };
  const keyToMi = k => (+k.slice(0, 4) - P0.y) * 12 + (+k.slice(5) - 1) - P0.m;
  const sumF = arr => { let s = 0; for (let i = 0; i < arr.length; i++) { if (!fin(arr[i])) return NaN; s += arr[i]; } return s; };

  // Monthly revenue / COGS per combo and per location (all categories & channels).
  const MCUBE = new Float64Array(A.NMONTH * NC * 2), LOCM = new Float64Array(A.NMONTH * NL * 2);
  for (let d = 0; d < A.ND; d++) {
    const mi = A.dayMonth[d];
    for (let ci = 0; ci < NC; ci++) {
      const b = (d * NC + ci) * NM;
      if (!S[b + 2]) continue;
      MCUBE[(mi * NC + ci) * 2] += S[b]; MCUBE[(mi * NC + ci) * 2 + 1] += S[b + 1];
      LOCM[(mi * NL + CLOC[ci]) * 2] += S[b]; LOCM[(mi * NL + CLOC[ci]) * 2 + 1] += S[b + 1];
    }
  }
  // Full-history daily revenue for a set of combos (cached).
  const sdCache = new Map();
  function sliceDaily(cbs) {
    const key = cbs.join(',');
    let v = sdCache.get(key);
    if (v) return v;
    const rev = new Float64Array(A.ND), cogs = new Float64Array(A.ND);
    for (let d = 0; d < A.ND; d++) { const row = d * NC; for (let j = 0; j < cbs.length; j++) { const b = (row + cbs[j]) * NM; rev[d] += S[b]; cogs[d] += S[b + 1]; } }
    v = { rev, cogs };
    if (sdCache.size > 400) sdCache.clear();
    sdCache.set(key, v);
    return v;
  }
  const locCombos = (sel, li) => Array.from(sel.combos).filter(ci => CLOC[ci] === li);
  const selLocs = sel => LOCS.map((_, i) => i).filter(i => sel.locOk[i] && locCombos(sel, i).length);

  // ── Targets (budget) ────────────────────────────────────────────────────────
  // Default: same month last year per location × (1 + growth); margin = last year's GM % + uplift.
  // Overrides per month and location live in localStorage "adrial-analytics-targets".
  const TDEF = { growth: 12, marginPP: 0.5, rev: {}, gm: {} };
  let targets = loadTargets();
  function loadTargets() {
    const t = lsGet('targets', null), o = { growth: TDEF.growth, marginPP: TDEF.marginPP, rev: {}, gm: {} };
    if (!t || typeof t !== 'object') return o;
    if (fin(+t.growth) && +t.growth > -90 && +t.growth < 500) o.growth = +t.growth;
    if (fin(+t.marginPP) && Math.abs(+t.marginPP) < 50) o.marginPP = +t.marginPP;
    ['rev', 'gm'].forEach(k => {
      if (!t[k] || typeof t[k] !== 'object') return;
      Object.keys(t[k]).forEach(m => {
        if (!/^\d{4}-\d{2}$/.test(m) || !t[k][m] || typeof t[k][m] !== 'object') return;
        Object.keys(t[k][m]).forEach(id => {
          const v = +t[k][m][id];
          if (LOCS.some(L => L.id === id) && fin(v) && v >= 0 && (k === 'rev' || v < 1)) (o[k][m] = o[k][m] || {})[id] = v;
        });
      });
    });
    return o;
  }
  const saveTargets = () => lsSet('targets', targets);
  function defRev(mi, li) { const ly = mi - 12; return ly >= 0 && ly < A.NMONTH ? LOCM[(ly * NL + li) * 2] * (1 + targets.growth / 100) : NaN; }
  function defGm(mi, li) {
    const ly = mi - 12;
    if (ly < 0 || ly >= A.NMONTH) return NaN;
    const r = LOCM[(ly * NL + li) * 2], c = LOCM[(ly * NL + li) * 2 + 1];
    return r ? (r - c) / r + targets.marginPP / 100 : NaN;
  }
  function tRev(mi, li) { const o = targets.rev[mKey(mi)]; return o && fin(o[LOCS[li].id]) ? o[LOCS[li].id] : defRev(mi, li); }
  function tGm(mi, li) { const o = targets.gm[mKey(mi)]; return o && fin(o[LOCS[li].id]) ? o[LOCS[li].id] : defGm(mi, li); }
  // Daily target revenue / gross profit for day indices d0…d1 (may run past today). A location's monthly
  // target is scaled to the filtered slice by last year's slice share, then spread over the month's days
  // with last year's weekday-aligned (364 days back) daily pattern. Totals are sums of locations.
  function targetSeries(sel, d0, d1, only) {
    const n = d1 - d0 + 1, rev = new Float64Array(n).fill(NaN), gp = new Float64Array(n).fill(NaN);
    (only || selLocs(sel)).forEach(li => {
      const cbs = locCombos(sel, li);
      if (!cbs.length) return;
      const y = sliceDaily(cbs).rev;
      for (let mi = mIdx(A.START + d0); mi <= mIdx(A.START + d1); mi++) {
        const ly = mi - 12;
        if (ly < 0 || ly >= A.NMONTH) continue;
        const locLY = LOCM[(ly * NL + li) * 2];
        let sl = 0;
        cbs.forEach(ci => { sl += MCUBE[(ly * NC + ci) * 2]; });
        const mt = locLY ? tRev(mi, li) * sl / locLY : 0, g = tGm(mi, li);
        if (!fin(mt)) continue;
        const ms = mStart(mi) - A.START, me = mEnd(mi) - A.START, days = me - ms + 1;
        let ws = 0;
        for (let d = ms; d <= me; d++) { const q = d - 364; if (q >= 0 && q < A.ND) ws += y[q]; }
        for (let d = Math.max(ms, d0); d <= Math.min(me, d1); d++) {
          const q = d - 364, w = ws > 0 ? (q >= 0 && q < A.ND ? y[q] : 0) / ws : 1 / days, i = d - d0, v = mt * w;
          if (!fin(rev[i])) { rev[i] = 0; gp[i] = 0; }
          rev[i] += v; gp[i] += v * (fin(g) ? g : 0);
        }
      }
    });
    return { rev, gp };
  }
  function targetTotal(sel, d0, d1, only) { const t = targetSeries(sel, d0, d1, only); return { rev: sumF(t.rev), gp: sumF(t.gp) }; }

  // ── Forecast ────────────────────────────────────────────────────────────────
  // Per location: level = weighted moving average of the last 28 days with weekday effects removed
  // (weights 1…28, newest heaviest); weekday factors from the last 8 weeks; seasonality = last year's
  // 7-day centred average 364 days earlier ÷ last year's 28-day average at the same point. Public
  // holidays close stores (e-shops ×0.75). 80 % band: day noise (log residual σ of the last 8 weeks)
  // plus a level uncertainty growing with √horizon (3.5 % per √30 days), summed over locations.
  const fcCache = new Map();
  function forecastSlice(sel, H) {
    const key = Array.from(sel.combos).join(',') + '|' + H;
    if (fcCache.has(key)) return fcCache.get(key);
    const fc = new Float64Array(H), dayVar = new Float64Array(H);
    selLocs(sel).forEach(li => {
      const L = LOCS[li], y = sliceDaily(locCombos(sel, li)).rev, hol = dn => A.isHoliday(L.country, dn);
      const sW = new Float64Array(7), cW = new Float64Array(7);
      for (let d = TI - 55; d <= TI; d++) { const dn = A.START + d; if (hol(dn)) continue; const wd = dParts(dn).wd; sW[wd] += y[d]; cW[wd]++; }
      const all = sum(sW) / Math.max(1, sum(cW));
      const wf = Array.from(sW, (s0, i) => cW[i] && all ? s0 / cW[i] / all : 1);
      let num = 0, den = 0;
      for (let k = 0; k < 28; k++) { const d = TI - 27 + k, dn = A.START + d, f = wf[dParts(dn).wd]; if (hol(dn) || f < 0.05) continue; num += (k + 1) * y[d] / f; den += k + 1; }
      const level = den ? num / den : 0;
      let ly = 0;
      for (let d = TI - 364 - 27; d <= TI - 364; d++) ly += y[d];
      ly /= 28;
      const sm = d => { let s0 = 0, c = 0; for (let k = -3; k <= 3; k++) { const q = d + k; if (q >= 0 && q < A.ND) { s0 += y[q]; c++; } } return c ? s0 / c : 0; };
      const lr = [];
      for (let d = TI - 55; d <= TI - 3; d++) { const dn = A.START + d; if (hol(dn)) continue; const e = sm(d) * wf[dParts(dn).wd]; if (e > 0 && y[d] > 0) lr.push(Math.log(y[d] / e)); }
      const mu = lr.length ? sum(lr) / lr.length : 0;
      const sd = lr.length > 2 ? Math.sqrt(lr.reduce((a, x) => a + (x - mu) * (x - mu), 0) / (lr.length - 1)) : 0.25;
      for (let h = 1; h <= H; h++) {
        const d = TI + h, dn = A.START + d;
        let v = level * (ly > 0 ? sm(d - 364) / ly : 1) * wf[dParts(dn).wd];
        if (hol(dn)) v *= L.type === 'store' ? 0 : 0.75;
        v = fin(v) && v > 0 ? v : 0;
        fc[h - 1] += v; dayVar[h - 1] += (v * sd) * (v * sd);
      }
    });
    const out = { fc, dayVar, H };
    if (fcCache.size > 60) fcCache.clear();
    fcCache.set(key, out);
    return out;
  }
  const levelSd = h => 0.035 * Math.sqrt(h / 30);
  // Sum of forecast days h0…h1 (1-based) with an approximate 80 % band.
  function fcSum(F, h0, h1) {
    let s0 = 0, v = 0, lev = 0;
    for (let h = Math.max(1, h0); h <= Math.min(F.H, h1); h++) { s0 += F.fc[h - 1]; v += F.dayVar[h - 1]; lev += F.fc[h - 1] * levelSd(h); }
    const sd = Math.sqrt(v) + lev;
    return { v: s0, lo: Math.max(0, s0 - 1.2816 * sd), hi: s0 + 1.2816 * sd };
  }
  // Current month: actual to date + forecast for the remaining days, vs the month's target.
  function monthProjection(sel) {
    const mi = mIdx(A.TODAY), ms = mStart(mi) - A.START, me = mEnd(mi) - A.START;
    const y = sliceDaily(Array.from(sel.combos)).rev;
    let act = 0;
    for (let d = ms; d <= TI; d++) act += y[d];
    const F = forecastSlice(sel, 90), rest = fcSum(F, 1, me - TI);
    const tgt = targetTotal(sel, ms, me);
    return { mi, act, rest: rest.v, proj: act + rest.v, lo: act + rest.lo, hi: act + rest.hi, target: tgt.rev, att: div(act + rest.v, tgt.rev), daysLeft: me - TI };
  }

  function overlaySeg() {
    const on = k => st.ov !== 'none' && st.ov.includes(k);
    return `<div class="seg sm" role="group" aria-label="Overlays"><button type="button" data-ovl="t" aria-pressed="${on('t')}">Target</button><button type="button" data-ovl="f" aria-pressed="${on('f')}">Forecast</button></div>`;
  }

  // Revenue (or any daily measure) trend card with comparison, target and forecast overlays.
  function trendCard(id, R, cur, cmp, key, o = {}) {
    const isRev = key === 'rev' && !o.value && o.sel;
    const showT = isRev && st.ov !== 'none' && st.ov.includes('t');
    const showF = isRev && st.ov !== 'none' && st.ov.includes('f') && R.b === A.TODAY;
    const H = showF ? Math.min(90, Math.max(7, R.n)) : 0;
    const N = R.n + H, g = gran(N), B = makeBuckets(R.ai, N, g);
    const val = o.value || (D => D[key]);
    const arr = val(cur.D), cs = new Float64Array(B.length).fill(NaN);
    for (let i = 0; i < R.n; i++) { const b = B.of[i]; cs[b] = (fin(cs[b]) ? cs[b] : 0) + arr[i]; }
    const ps = cmp ? sumBc(val(cmp.D), B) : null;
    let ts = null;
    if (showT) {
      const t = targetSeries(o.sel, R.ai, R.ai + N - 1), bad = new Uint8Array(B.length);
      ts = new Float64Array(B.length).fill(0);
      for (let i = 0; i < N; i++) { const b = B.of[i]; if (fin(t.rev[i])) ts[b] += t.rev[i]; else bad[b] = 1; }
      B.forEach((_, j) => { if (bad[j]) ts[j] = NaN; });
      if (!ts.some(fin)) ts = null;
    }
    let fs = null, flo = null, fhi = null, F = null;
    if (showF) {
      F = forecastSlice(o.sel, H);
      fs = new Float64Array(B.length).fill(NaN); flo = new Float64Array(B.length).fill(NaN); fhi = new Float64Array(B.length).fill(NaN);
      const lastB = B.of[R.n - 1];
      B.forEach((b, j) => {
        const h0 = b.i0 - (R.n - 1), h1 = b.i1 - (R.n - 1);
        if (h1 < 1) { if (j === lastB) { fs[j] = cs[j]; flo[j] = cs[j]; fhi[j] = cs[j]; } return; }
        const part = fcSum(F, h0, h1), act = fin(cs[j]) ? cs[j] : 0;
        fs[j] = act + part.v; flo[j] = act + part.lo; fhi[j] = act + part.hi;
      });
    }
    const f = o.fmt || fmt.eur, fy = o.fmtY || fmt.eurK;
    const bands = [];
    B.forEach((b, j) => { if (b.i0 < R.n && promosIn(R.ai, b.i0, Math.min(b.i1, R.n - 1)).length) bands.push(j); });
    const rows = B.map((b, j) => ({ v: [b.full, b.i0 < R.n ? cs[j] : NaN, ps ? ps[j] : NaN, ps ? chg(cs[j], ps[j]) : NaN, ts ? ts[j] : NaN, ts && b.i1 < R.n ? chg(cs[j], ts[j]) : NaN,
      fs && b.i1 >= R.n ? fs[j] : NaN, flo && b.i1 >= R.n ? flo[j] : NaN, fhi && b.i1 >= R.n ? fhi[j] : NaN, promosIn(R.ai, b.i0, b.i1).join(', ')] }));
    const table = { caption: o.title, cols: [{ h: 'Period' }, { h: (o.metric || 'Revenue') + ' (actual)', t: o.t || 'eur' }, { h: 'Comparison', t: o.t || 'eur' }, { h: 'Change', t: 'chg' },
      { h: 'Target', t: 'eur' }, { h: 'Vs target', t: 'chg' }, { h: 'Forecast', t: 'eur' }, { h: 'Forecast low (80%)', t: 'eur' }, { h: 'Forecast high (80%)', t: 'eur' }, { h: 'Promotion' }], rows };
    if (!showT && !showF) { table.cols.splice(4, 5); rows.forEach(r => r.v.splice(4, 5)); }
    else if (!showF) { table.cols.splice(6, 3); rows.forEach(r => r.v.splice(6, 3)); }
    else if (!showT) { table.cols.splice(4, 2); rows.forEach(r => r.v.splice(4, 2)); }
    const draw = w => lineChart({
      w, h: o.h || 260, labels: B.map(b => b.short), aria: `${o.title}, ${B.length} ${g} points from ${rangeLabel(R.a, R.b)}${H ? ' plus ' + H + ' forecast days' : ''}`,
      fmtY: fy, bands, marker: H ? B.of[R.n - 1] : null, markerLabel: 'Today',
      series: [
        ps ? { name: 'Comparison', vals: ps, color: 'var(--ink3)', dash: true, width: 1.6 } : null,
        ts ? { name: 'Target', vals: ts, color: 'var(--c3)', dash: '1.5 3.5', width: 2 } : null,
        fs ? { name: 'Forecast', vals: fs, color: 'var(--accent)', dash: '6 4', width: 2, band: { lo: flo, hi: fhi } } : null,
        { name: 'Current', vals: cs, color: 'var(--accent)', area: true }].filter(Boolean),
      tips: j => {
        const b = B[j], pr = promosIn(R.ai, b.i0, b.i1), fut = b.i1 >= R.n;
        let t = `<b>${esc(b.full)}</b>`;
        if (b.i0 < R.n) t += `<br>${esc(o.metric || 'Revenue')}${fut ? ' so far' : ''}: ${f(cs[j])}`;
        if (ps && b.i0 < R.n) { const cl = cmpBucketLabel(R, b); t += `<br><span class="tmuted">${esc(cl || 'Comparison')}: ${f(ps[j])}</span> ${fin(ps[j]) ? deltaHtml(cs[j], ps[j]) : ''}`; }
        if (ts && fin(ts[j])) t += `<br><span class="tmuted">Target: ${f(ts[j])}</span>${!fut ? ' ' + deltaHtml(cs[j], ts[j]) : ''}`;
        if (fs && fut && fin(fs[j])) t += `<br>Forecast${b.i0 < R.n ? ' (incl. actual)' : ''}: ${f(fs[j])}<br><span class="tmuted">80% range ${fmt.eurK(flo[j])} – ${fmt.eurK(fhi[j])}</span>`;
        if (pr.length) t += `<br><span class="tmuted">Promotion: ${esc(pr.join(', '))}</span>`;
        return t;
      }
    });
    const leg = legend([{ label: 'Actual · ' + rangeLabel(R.a, R.b), color: 'var(--accent)' }]
      .concat(cmp ? [{ label: cmpName()[0].toUpperCase() + cmpName().slice(1) + ' · ' + rangeLabel(R.ca, R.cb), color: 'var(--ink3)', dash: true }] : [])
      .concat(ts ? [{ label: 'Target', color: 'var(--c3)', dash: true, dot: true }] : [])
      .concat(fs ? [{ label: `Forecast, next ${H} days (80% band)`, color: 'var(--accent)', dash: true }] : [])
      .concat(bands.length ? [{ label: 'Promotion', color: 'var(--fill)' }] : []));
    const note = isRev && st.ov.includes('f') && st.ov !== 'none' && R.b !== A.TODAY ? ' · forecast shows when the range ends today' : '';
    return {
      html: card({ id, title: o.title, sub: o.sub || `${g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'} · ${R.cmpOk ? cmpName() + ' dashed' : 'no comparison available'}${note}`, actions: (isRev ? overlaySeg() : '') + granSeg(), body: leg + chartDiv(id + '-c', o.h || 260), table, cls: o.cls }),
      mount: () => mount(id + '-c', draw)
    };
  }

  // Target attainment tiles (range vs target, margin vs target, month-end projection).
  function targetTiles(R, sel, cur, opts = {}) {
    const t = targetTotal(sel, R.ai, R.bi), act = cur.tot.rev, gm = div(act - cur.tot.cogs, act), tgm = div(t.gp, t.rev);
    const P = monthProjection(sel);
    const att = div(act, t.rev);
    const tile = (label, v, d, title) => `<article class="kpi tgt" title="${esc(title || '')}"><div class="l">${esc(label)}</div><div class="v">${v}</div><div class="d">${d}</div></article>`;
    const noT = '<span class="muted">No target: needs last year’s data</span>';
    const tiles = [
      tile('Revenue vs target', esc(fmt.pct0(att)), fin(t.rev) ? `${deltaHtml(act, t.rev)}<span class="muted">${fmt.eurK(act)} of ${fmt.eurK(t.rev)}</span>` : noT, 'Selected period, filtered slice'),
      tile('Margin vs target', esc(fmt.pct(gm)), fin(tgm) ? `${deltaHtml(gm, tgm, 'pp')}<span class="muted">target ${fmt.pct(tgm)}</span>` : noT),
      tile(mName(P.mi, true) + ' projection', esc(fmt.eurK(P.proj)), fin(P.target) ? `<span class="delta ${P.att >= 1 ? 'good' : 'bad'}">${fmt.pct0(P.att)} of target</span><span class="muted">on pace for ${fmt.eurK(P.proj)} vs ${fmt.eurK(P.target)}</span>` : `<span class="muted">${fmt.eurK(P.act)} so far · ${P.daysLeft} days forecast</span>`,
        `Actual to date ${fmt.eur(P.act)} + forecast ${fmt.eur(P.rest)} for the remaining ${P.daysLeft} days (80% range ${fmt.eurK(P.lo)} – ${fmt.eurK(P.hi)})`)
    ];
    if (opts.extra) tiles.push(opts.extra);
    return `<section class="kpis tgts" aria-label="Targets"><div class="tg-h"><span class="label">Targets &amp; forecast</span>${opts.link === false ? '' : `<a class="tlink" href="${hashFor('targets')}">Details →</a>`}</div>${tiles.join('')}</section>`;
  }

  // ── Products maths ──────────────────────────────────────────────────────────
  const PROD_BY_CAT = CATS.map((_, c) => A.PRODUCTS.filter(p => p.cat === c));
  function productStats(catMonth) {
    const out = A.PRODUCTS.map(p => ({ p, rev: 0, cogs: 0, units: 0, retRev: 0, retUnits: 0, orders: 0 }));
    for (let mi = 0; mi < A.NMONTH; mi++) {
      for (let c = 0; c < 6; c++) {
        const b = (mi * 6 + c) * NM, rev = catMonth[b];
        if (!rev && !catMonth[b + 2]) continue;
        const ps = PROD_BY_CAT[c], sh = ps.map(p => A.SHARE[mi * A.NP + p.idx]);
        const wC = ps.map((p, i) => sh[i] * (1 - p.margin)), wU = ps.map((p, i) => sh[i] / p.price), wR = ps.map((p, i) => sh[i] * p.ret);
        const sC = sum(wC), sU = sum(wU), sR = sum(wR), sS = sum(sh);
        ps.forEach((p, i) => {
          const o = out[p.idx];
          o.rev += rev * sh[i] / sS; o.cogs += catMonth[b + 1] * wC[i] / sC; o.units += catMonth[b + 3] * wU[i] / sU;
          o.orders += catMonth[b + 2] * sh[i] / sS; o.retRev += catMonth[b + 5] * wR[i] / sR; o.retUnits += catMonth[b + 6] * wR[i] / sR;
        });
      }
    }
    return out;
  }
  function abc(stats) {
    const list = stats.filter(s => s.rev > 0).sort((a, b) => b.rev - a.rev), tot = sum(list.map(s => s.rev));
    let cum = 0;
    list.forEach(s => { s.prev = tot ? cum / tot : 0; cum += s.rev; s.cum = tot ? cum / tot : 0; s.cls = s.prev < 0.8 ? 'A' : s.prev < 0.95 ? 'B' : 'C'; });
    return list;
  }

  // ── Pages ───────────────────────────────────────────────────────────────────
  function pageOverview(R, sel, cur, cmp) {
    const K = kpis(cur.tot), KC = cmp ? kpis(cmp.tot) : null;
    const SB = sparkBuckets(R), sk = bucketTotals(cur.D, SB).map(kpis);
    const parts = [], mounts = [];
    parts.push(kpiTiles(KPI_DEFS, K, KC, sk, R));
    addExport('Key figures', { cols: [{ h: 'Metric' }, { h: 'Current', t: 'num' }, { h: 'Comparison', t: 'num' }], rows: KPI_DEFS.map(d => ({ v: [d.label, d.type === 'pp' ? K[d.k] * 100 : K[d.k], KC ? (d.type === 'pp' ? KC[d.k] * 100 : KC[d.k]) : NaN] })) });

    parts.push(targetTiles(R, sel, cur));
    const tr = trendCard('ov-trend', R, cur, cmp, 'rev', { title: 'Revenue trend', sel });
    parts.push(tr.html); mounts.push(tr.mount);

    // By category / channel / country
    const gc = group(cur.combo, c => c.cat, 6), gp = cmp ? group(cmp.combo, c => c.cat, 6) : null;
    const catItems = CATS.map((c, i) => ({ i, label: c.name, value: gc[i][0], prev: gp ? gp[i][0] : NaN, color: color(i) })).filter(x => sel.catOk[x.i]);
    const tot = cur.tot.rev;
    const catTable = { caption: 'Revenue by category', cols: [{ h: 'Category' }, { h: 'Revenue', t: 'eur' }, { h: 'Share', t: 'pct' }, { h: 'Change', t: 'chg' }], rows: catItems.map(x => ({ v: [x.label, x.value, div(x.value, tot), chg(x.value, x.prev)] })), foot: ['Total', tot, tot ? 1 : NaN, chg(tot, cmp ? cmp.tot.rev : NaN)] };
    const catDraw = w => donutChart({
      w, size: 210, aria: 'Revenue by category donut chart', center: fmt.eurK(tot), centerSub: 'REVENUE',
      items: catItems.map(x => ({ value: x.value, color: x.color, tip: `<b>${esc(x.label)}</b><br>${fmt.eur(x.value)} · ${fmt.pct(div(x.value, tot))} of revenue<br>${KC ? deltaHtml(x.value, x.prev) + ' ' + cmpShort() : ''}` }))
    });
    const catLeg = `<ul class="dlist">${catItems.map(x => `<li><i class="dot" style="background:${x.color}"></i><span>${esc(x.label)}</span><b>${fmt.eurK(x.value)}</b><em>${fmt.pct(div(x.value, tot))}</em></li>`).join('')}</ul>`;

    const gch = group(cur.combo, c => c.ch, 3), gchp = cmp ? group(cmp.combo, c => c.ch, 3) : null;
    const chRows = CHANNELS.map((c, i) => ({ i, label: c.name, value: gch[i][0], prev: gchp ? gchp[i][0] : NaN, orders: gch[i][2] })).filter(x => sel.chOk[x.i]);
    const chTable = { caption: 'Revenue by channel', cols: [{ h: 'Channel' }, { h: 'Revenue', t: 'eur' }, { h: 'Orders', t: 'int' }, { h: 'Share', t: 'pct' }, { h: 'Change', t: 'chg' }], rows: chRows.map(x => ({ v: [x.label, x.value, x.orders, div(x.value, tot), chg(x.value, x.prev)] })), foot: ['Total', tot, cur.tot.orders, tot ? 1 : NaN, chg(tot, cmp ? cmp.tot.rev : NaN)] };
    const chDraw = w => hbarChart({
      w, aria: 'Revenue by channel bar chart', fmt: fmt.eurK,
      rows: chRows.map(x => ({ label: x.label, sub: fmt.pct(div(x.value, tot)) + ' of revenue', value: x.value, color: CH_COLOR[x.i], tip: `<b>${esc(x.label)}</b><br>${fmt.eur(x.value)} · ${fmt.int(x.orders)} orders<br>${KC ? deltaHtml(x.value, x.prev) + ' ' + cmpShort() : ''}` }))
    });
    const coKeys = ['SI', 'HR'];
    const gco = group(cur.combo, c => coKeys.indexOf(LOCS[c.loc].country), 2), gcop = cmp ? group(cmp.combo, c => coKeys.indexOf(LOCS[c.loc].country), 2) : null;
    const coRows = coKeys.map((k, i) => ({ label: k === 'SI' ? 'Slovenia' : 'Croatia', k, value: gco[i][0], prev: gcop ? gcop[i][0] : NaN, orders: gco[i][2] })).filter(x => st.co === 'all' || st.co === x.k);
    const coTable = { caption: 'Revenue by country', cols: [{ h: 'Country' }, { h: 'Revenue', t: 'eur' }, { h: 'Orders', t: 'int' }, { h: 'Share', t: 'pct' }, { h: 'Change', t: 'chg' }], rows: coRows.map(x => ({ v: [x.label, x.value, x.orders, div(x.value, tot), chg(x.value, x.prev)] })), foot: ['Total', tot, cur.tot.orders, tot ? 1 : NaN, chg(tot, cmp ? cmp.tot.rev : NaN)] };
    const coDraw = w => hbarChart({
      w, aria: 'Revenue by country bar chart', fmt: fmt.eurK,
      rows: coRows.map(x => ({ label: x.label, sub: fmt.pct(div(x.value, tot)) + ' of revenue', value: x.value, color: CO_COLOR[x.k], tip: `<b>${esc(x.label)}</b><br>${fmt.eur(x.value)} · ${fmt.int(x.orders)} orders<br>${KC ? deltaHtml(x.value, x.prev) + ' ' + cmpShort() : ''}` }))
    });
    parts.push(`<div class="grid g3">${card({ id: 'ov-cat', title: 'Revenue by category', sub: 'Share of revenue in the period', body: chartDiv('ov-cat-c', 210) + catLeg, table: catTable })}` +
      card({ id: 'ov-ch', title: 'By channel', sub: 'Store, e-shop and marketplace', body: chartDiv('ov-ch-c'), table: chTable }) +
      card({ id: 'ov-co', title: 'By country', sub: 'Slovenia and Croatia', body: chartDiv('ov-co-c'), table: coTable }) + '</div>');
    mounts.push(() => mount('ov-cat-c', catDraw), () => mount('ov-ch-c', chDraw), () => mount('ov-co-c', coDraw));

    // Leaderboard
    const gl = group(cur.combo, c => c.loc, LOCS.length), glp = cmp ? group(cmp.combo, c => c.loc, LOCS.length) : null;
    const lb = LOCS.map((L, i) => ({ L, i, rev: gl[i][0], orders: gl[i][2], prev: glp ? glp[i][0] : NaN })).filter(x => sel.locOk[x.i] && x.rev > 0).sort((a, b) => b.rev - a.rev).slice(0, 10);
    const lbTable = { caption: 'Top 10 locations', cols: [{ h: '#', t: 'int' }, { h: 'Location' }, { h: 'Country' }, { h: 'Revenue', t: 'eur' }, { h: 'Orders', t: 'int' }, { h: 'Change', t: 'chg' }], rows: lb.map((x, j) => ({ v: [j + 1, x.L.name, x.L.country, x.rev, x.orders, chg(x.rev, x.prev)] })) };
    const lbDraw = w => hbarChart({
      w, aria: 'Top locations by revenue bar chart', fmt: fmt.eurK,
      rows: lb.map((x, j) => ({ label: (j + 1) + '. ' + x.L.name, sub: x.L.country + ' · ' + (x.L.type === 'store' ? 'Store' : 'E-shop'), value: x.rev, color: 'var(--accent)',
        tip: `<b>${esc(x.L.name)}</b><br>${fmt.eur(x.rev)} · ${fmt.int(x.orders)} orders<br>${KC ? deltaHtml(x.rev, x.prev) + ' ' + cmpShort() + '<br>' : ''}<span class="tmuted">Click for details</span>`,
        onClick: () => { location.hash = hashFor('stores', x.L.id); } }))
    });
    // Top products
    const ps = productStats(cur.catMonth), pp = cmp ? productStats(cmp.catMonth) : null;
    const top = ps.filter(s => s.rev > 0).sort((a, b) => b.rev - a.rev).slice(0, 10);
    const tpTable = {
      caption: 'Top products', cols: [{ h: '#', t: 'int' }, { h: 'Product', render: (v, row) => `<span class="name">${esc(v)}<small>${esc(row.sku)}</small></span>` }, { h: 'Category' }, { h: 'Units', t: 'int' }, { h: 'Revenue', t: 'eur' }, { h: 'Margin', t: 'pct' }, { h: 'Change', t: 'chg' }],
      rows: top.map((s, j) => ({ sku: s.p.sku, v: [j + 1, s.p.name, CATS[s.p.cat].name, s.units, s.rev, div(s.rev - s.cogs, s.rev), pp ? chg(s.rev, pp[s.p.idx].rev) : NaN] }))
    };
    addExport('Top products', tpTable);
    parts.push(`<div class="grid g2">${card({ id: 'ov-lb', title: 'Top 10 locations', sub: 'Revenue leaderboard · click a bar for the location', body: chartDiv('ov-lb-c'), table: lbTable })}` +
      card({ id: 'ov-tp', title: 'Top products', sub: 'By revenue in the period', body: tableHtml(tpTable, 'ov-tp-t') }) + '</div>');
    mounts.push(() => mount('ov-lb-c', lbDraw));
    return { html: parts.join(''), mounts };
  }

  function pageStores(R, sel, cur, cmp) {
    const parts = [], mounts = [];
    const yoyOk = shiftYear(R.a, -1) >= A.START;
    const yoy = st.c === 'yoy' ? cmp : (yoyOk ? compute(shiftYear(R.a, -1) - A.START, shiftYear(R.b, -1) - A.START, sel) : null);
    const gl = group(cur.combo, c => c.loc, LOCS.length), gly = yoy ? group(yoy.combo, c => c.loc, LOCS.length) : null;
    const glE = group(cur.combo, c => c.ch === 1 ? c.loc : -1, LOCS.length);
    const rows = LOCS.map((L, i) => {
      if (!sel.locOk[i]) return null;
      const isS = L.type === 'store';
      if (isS ? !sel.chOk[0] : !(sel.chOk[1] || sel.chOk[2])) return null;
      const g = gl[i];
      const traffic = isS ? cur.locOps[i * 3] : NaN, exams = isS ? cur.locOps[i * 3 + 2] : NaN;
      const conv = isS ? div(g[2], traffic) : div(glE[i][2], cur.locFun[i * 3]);
      return { id: L.id, attr: `class="click" data-store="${L.id}"`, v: [L.name, L.country, isS ? 'Store' : 'E-shop', g[0], g[2], div(g[0], g[2]), div(g[0] - g[1], g[0]), isS && sel.chOk[0] ? traffic : NaN, (isS && sel.chOk[0]) || (!isS && sel.chOk[1]) ? conv : NaN, isS && sel.chOk[0] ? exams : NaN, gly ? chg(g[0], gly[i][0]) : NaN] };
    }).filter(Boolean);
    const T = cur.tot;
    const table = {
      sortable: true, caption: 'All locations',
      cols: [{ h: 'Location', render: (v, row) => `<button type="button" class="link" data-store="${esc(row.id)}">${esc(v)}</button>` }, { h: 'Country' }, { h: 'Type' }, { h: 'Revenue', t: 'eur' }, { h: 'Orders', t: 'int' }, { h: 'AOV', t: 'eur2' }, { h: 'Margin', t: 'pct' },
        { h: 'Foot traffic', t: 'int' }, { h: 'Conversion', t: 'pct' }, { h: 'Eye exams', t: 'int' }, { h: 'YoY', t: 'chg' }],
      rows,
      foot: ['All selected', '', '', T.rev, T.orders, div(T.rev, T.orders), div(T.rev - T.cogs, T.rev), sel.stores.length ? T.traffic : NaN, NaN, sel.stores.length ? T.exams : NaN, yoy ? chg(T.rev, yoy.tot.rev) : NaN]
    };
    addExport('All locations', table);
    if (!ui.sort['st-t']) ui.sort['st-t'] = { c: 3, d: -1 };
    parts.push(`<section class="card" id="st-tbl" aria-labelledby="st-tbl-h"><header class="ch"><div class="chl"><h2 id="st-tbl-h">All locations</h2><p>Click a location for its trend and category mix. Conversion = orders ÷ foot traffic for stores, e-shop orders ÷ sessions online. YoY = revenue vs ${yoy ? rangeLabel(shiftYear(R.a, -1), shiftYear(R.b, -1)) : 'last year (not available)'}.</p></div></header>${tableHtml(table, 'st-t')}</section>`);

    // Map + SI vs HR
    const coKeys = ['SI', 'HR'];
    const points = LOCS.map((L, i) => ({
      label: L.name, lon: L.lon, lat: L.lat, online: L.type === 'eshop', left: L.id === 'si-novo-mesto' || L.id === 'si-koper', value: gl[i][0], active: sel.locOk[i] && gl[i][0] > 0, color: CO_COLOR[L.country],
      tip: sel.locOk[i] ? `<b>${esc(L.name)}</b> · ${L.country}<br>${fmt.eur(gl[i][0])} · ${fmt.int(gl[i][2])} orders<br><span class="tmuted">Click for details</span>` : `<b>${esc(L.name)}</b><br><span class="tmuted">Not in the current filter</span>`,
      onClick: sel.locOk[i] ? () => openStore(L.id) : null
    }));
    const mapDraw = w => bubbleMap({ w, points, aria: 'Map of locations, bubble size is revenue' });
    const mapTable = { caption: 'Locations map', cols: [{ h: 'Location' }, { h: 'Country' }, { h: 'Revenue', t: 'eur' }], rows: LOCS.map((L, i) => sel.locOk[i] ? { v: [L.name, L.country, gl[i][0]] } : null).filter(Boolean) };
    const gco = group(cur.combo, c => coKeys.indexOf(LOCS[c.loc].country), 2);
    const nLoc = coKeys.map(k => LOCS.filter((L, i) => sel.locOk[i] && L.country === k).length);
    const metrics = [
      { label: 'Revenue', fmt: fmt.eurK, vals: gco.map(g => g[0]) },
      { label: 'Orders', fmt: fmt.intK, vals: gco.map(g => g[2]) },
      { label: 'Avg order value', fmt: fmt.eur2, vals: gco.map(g => div(g[0], g[2])) },
      { label: 'Gross margin', fmt: fmt.pct, vals: gco.map(g => div(g[0] - g[1], g[0])) },
      { label: 'Return rate', fmt: fmt.pct, vals: gco.map(g => div(g[5], g[0])) },
      { label: 'Revenue per location', fmt: fmt.eurK, vals: gco.map((g, k) => div(g[0], nLoc[k])) }
    ];
    const cmpTable = { caption: 'Slovenia vs Croatia', cols: [{ h: 'Metric' }, { h: 'Slovenia', t: 'num' }, { h: 'Croatia', t: 'num' }], rows: metrics.map(m => ({ v: [m.label, m.vals[0], m.vals[1]] })) };
    cmpTable.cols[1].render = (v, row) => metrics.find(m => m.label === row.v[0]).fmt(v);
    cmpTable.cols[2].render = (v, row) => metrics.find(m => m.label === row.v[0]).fmt(v);
    const cmpDraw = w => groupBars({
      w, perRow: true, aria: 'Slovenia versus Croatia comparison', fmt: fmt.num2,
      series: [{ name: 'Slovenia', color: CO_COLOR.SI }, { name: 'Croatia', color: CO_COLOR.HR }],
      rows: metrics.map(m => ({ label: m.label, vals: m.vals, fmt: m.fmt, tip: `<b>${esc(m.label)}</b><br>Slovenia: ${m.fmt(m.vals[0])}<br>Croatia: ${m.fmt(m.vals[1])}` }))
    });
    parts.push(`<div class="grid g2">${card({ id: 'st-map', title: 'Where revenue comes from', sub: 'Approximate locations · bubble area = revenue', body: legend([{ label: 'Slovenia', color: CO_COLOR.SI }, { label: 'Croatia', color: CO_COLOR.HR }]) + chartDiv('st-map-c', 260), table: mapTable })}` +
      card({ id: 'st-cmp', title: 'Slovenia vs Croatia', sub: 'Each row is scaled to its own larger value', body: legend([{ label: 'Slovenia', color: CO_COLOR.SI }, { label: 'Croatia', color: CO_COLOR.HR }]) + chartDiv('st-cmp-c'), table: cmpTable }) + '</div>');
    mounts.push(() => mount('st-map-c', mapDraw), () => mount('st-cmp-c', cmpDraw));
    return { html: parts.join(''), mounts };
  }

  function pageEcom(R, sel, cur, cmp) {
    const parts = [], mounts = [];
    if (!sel.eshops.length) return { html: emptyCard('E-commerce & marketing', 'No e-shop is in the current filter. Choose the E-shop channel (or All) and include moje-lece.si or adrialece.hr.'), mounts };
    const T = cur.tot, P = cmp ? cmp.tot : null;
    const ek = t => ({ sessions: t.sessions, cr: div(t.eOrders, t.sessions), orders: t.eOrders, rev: t.eRev, spend: t.spend, roas: div(t.eRev, t.spend), cpa: div(t.spend, t.eOrders), aov: div(t.eRev, t.eOrders) });
    const K = ek(T), KC = P ? ek(P) : null;
    const SB = sparkBuckets(R), sk = bucketTotals(cur.D, SB).map(ek);
    const defs = [
      { k: 'sessions', label: 'Sessions', f: fmt.intK }, { k: 'cr', label: 'Conversion rate', f: fmt.pct2, type: 'pp' },
      { k: 'orders', label: 'E-shop orders', f: fmt.intK }, { k: 'rev', label: 'E-shop revenue', f: fmt.eurK },
      { k: 'spend', label: 'Marketing spend', f: fmt.eurK, inverse: true }, { k: 'roas', label: 'ROAS (blended)', f: fmt.x },
      { k: 'cpa', label: 'Cost per order', f: fmt.eur2, inverse: true }, { k: 'aov', label: 'E-shop AOV', f: fmt.eur2 }
    ];
    parts.push(kpiTiles(defs, K, KC, sk, R));

    // Funnel
    const steps = [['Sessions', T.sessions], ['Product views', T.views], ['Add to cart', T.atc], ['Checkout', T.checkout], ['Orders', T.fOrders]];
    const stepsP = P ? [P.sessions, P.views, P.atc, P.checkout, P.fOrders] : null;
    const funTable = { caption: 'Funnel', cols: [{ h: 'Step' }, { h: 'Count', t: 'int' }, { h: 'Step conversion', t: 'pct' }, { h: 'Of sessions', t: 'pct2' }, { h: 'Comparison', t: 'int' }], rows: steps.map((s, i) => ({ v: [s[0], s[1], i ? div(s[1], steps[i - 1][1]) : NaN, div(s[1], T.sessions), stepsP ? stepsP[i] : NaN] })) };
    const funDraw = w => hbarChart({
      w, aria: 'E-shop funnel from sessions to orders', fmt: fmt.int, rowH: 46, barH: 14,
      rows: steps.map((s, i) => ({ label: s[0], sub: i ? fmt.pct(div(s[1], steps[i - 1][1])) + ' of previous step' : '100% of sessions', value: s[1], color: 'var(--accent)',
        tip: `<b>${esc(s[0])}</b><br>${fmt.int(s[1])}${i ? `<br>${fmt.pct(div(s[1], steps[i - 1][1]))} of ${esc(steps[i - 1][0].toLowerCase())}<br>${fmt.pct2(div(s[1], T.sessions))} of sessions` : ''}${stepsP ? `<br><span class="tmuted">Comparison: ${fmt.int(stepsP[i])}</span>` : ''}` }))
    });
    // Sources
    const srcRow = (src, s) => ({ sessions: src[s * 7], orders: src[s * 7 + 4], spend: src[s * 7 + 5], rev: src[s * 7 + 6] });
    const srcs = SOURCES.map((S0, s) => Object.assign({ s, name: S0.name, paid: S0.paid }, srcRow(cur.src, s), { prevRev: cmp ? cmp.src[s * 7 + 6] : NaN }));
    const mkTable = {
      sortable: true, caption: 'Marketing by source',
      cols: [{ h: 'Source' }, { h: 'Sessions', t: 'int' }, { h: 'Orders', t: 'int' }, { h: 'Conv. rate', t: 'pct2' }, { h: 'Spend', t: 'eur' }, { h: 'Revenue', t: 'eur' }, { h: 'CPA', t: 'eur2' }, { h: 'ROAS', t: 'x' }, { h: 'Revenue change', t: 'chg' }],
      rows: srcs.map(x => ({ v: [x.name, x.sessions, x.orders, div(x.orders, x.sessions), x.spend, x.rev, x.spend ? div(x.spend, x.orders) : NaN, x.spend ? div(x.rev, x.spend) : NaN, chg(x.rev, x.prevRev)] })),
      foot: ['All sources', T.sessions, T.fOrders, div(T.fOrders, T.sessions), T.spend, T.eRev, div(T.spend, T.fOrders), div(T.eRev, T.spend), P ? chg(T.eRev, P.eRev) : NaN]
    };
    addExport('Marketing by source', mkTable);
    const svrDraw = w => groupBars({
      w, aria: 'Marketing spend versus attributed revenue by source', fmt: fmt.eurK,
      series: [{ name: 'Spend', color: 'var(--c2)' }, { name: 'Revenue', color: 'var(--c1)' }],
      rows: srcs.map(x => ({ label: x.name, vals: [x.spend, x.rev], tip: `<b>${esc(x.name)}</b><br>Spend: ${fmt.eur(x.spend)}<br>Revenue: ${fmt.eur(x.rev)}<br>ROAS: ${x.spend ? fmt.x(x.rev / x.spend) : '— (no spend)'}` }))
    });
    const svrTable = { caption: 'Spend vs revenue', cols: [{ h: 'Source' }, { h: 'Spend', t: 'eur' }, { h: 'Revenue', t: 'eur' }, { h: 'ROAS', t: 'x' }], rows: srcs.map(x => ({ v: [x.name, x.spend, x.rev, x.spend ? div(x.rev, x.spend) : NaN] })) };
    parts.push(`<div class="grid g2">${card({ id: 'ec-fun', title: 'Conversion funnel', sub: 'Sessions → orders, all e-shop categories' + (st.cat !== 'all' ? ' (the funnel is not split by category)' : ''), body: chartDiv('ec-fun-c'), table: funTable })}` +
      card({ id: 'ec-svr', title: 'Spend vs revenue by source', sub: 'Revenue attributed by last-click order share', body: legend([{ label: 'Spend', color: 'var(--c2)' }, { label: 'Revenue', color: 'var(--c1)' }]) + chartDiv('ec-svr-c'), table: svrTable }) + '</div>');
    mounts.push(() => mount('ec-fun-c', funDraw), () => mount('ec-svr-c', svrDraw));
    parts.push(`<section class="card" aria-labelledby="ec-mk-h"><header class="ch"><div class="chl"><h2 id="ec-mk-h">Marketing by source</h2><p>CPA = spend ÷ orders. ROAS = attributed revenue ÷ spend. Organic and Direct have no media spend.</p></div></header>${tableHtml(mkTable, 'ec-mk-t')}</section>`);

    // Sessions trend by source
    const g = gran(R.n), B = makeBuckets(R.ai, R.n, g);
    const ss = cur.srcSess.map(a => sumB(a, B));
    const sesTable = { caption: 'Sessions by source', cols: [{ h: 'Period' }].concat(SOURCES.map(s => ({ h: s.name, t: 'int' }))).concat([{ h: 'Total', t: 'int' }]), rows: B.map((b, j) => ({ v: [b.full].concat(ss.map(a => a[j])).concat([ss.reduce((a, x) => a + x[j], 0)]) })) };
    const sesDraw = w => lineChart({
      w, h: 260, labels: B.map(b => b.short), fmtY: fmt.intK, aria: 'Sessions trend by marketing source',
      series: SOURCES.map((s, i) => ({ name: s.name, vals: ss[i], color: color(i) })),
      tips: j => `<b>${esc(B[j].full)}</b>` + SOURCES.map((s, i) => `<br><i class="tdot" style="background:${color(i)}"></i>${esc(s.name)}: ${fmt.int(ss[i][j])}`).join('') + `<br><span class="tmuted">Total: ${fmt.int(ss.reduce((a, x) => a + x[j], 0))}</span>`
    });
    parts.push(card({ id: 'ec-ses', title: 'Sessions by source', sub: (g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly') + ' sessions per marketing source', actions: granSeg(), body: legend(SOURCES.map((s, i) => ({ label: s.name, color: color(i) }))) + chartDiv('ec-ses-c', 260), table: sesTable }));
    mounts.push(() => mount('ec-ses-c', sesDraw));
    return { html: parts.join(''), mounts };
  }

  function pageCustomers(R) {
    const sel = selection({ ignoreCat: true });
    const cur = compute(R.ai, R.bi, sel), cmp = R.cmpOk ? compute(R.cai, R.cbi, sel) : null;
    const parts = [], mounts = [];
    if (!sel.combos.length) return { html: emptyCard('Customers', 'No locations match the current filters.'), mounts };
    // Purchase frequency model: orders per customer = 1 + λ (shifted Poisson); λ grows with window length and repeat-heavy channels.
    const gk = group(cur.combo, c => c.ch, 3);
    const rf = div(gk[0][2] * 1 + gk[1][2] * 1.6 + gk[2][2] * 0.6, cur.tot.orders);
    const lam = n => 0.075 * Math.pow(n / 30.44, 0.85) * (fin(rf) ? rf : 1);
    const ck = (t, n) => { const m = 1 + lam(n); return { newC: t.newO, retC: t.orders - t.newO, repeat: div(t.orders - t.newO, t.orders), cust: div(t.orders, m), freq: t.orders ? m : NaN }; };
    const K = ck(cur.tot, R.n), KC = cmp ? ck(cmp.tot, R.cn) : null;
    const SB = sparkBuckets(R), sk = bucketTotals(cur.D, SB).map(t => ck(t, R.n / SB.length));
    parts.push(kpiTiles([
      { k: 'newC', label: 'New customers', f: fmt.intK }, { k: 'retC', label: 'Returning customers', f: fmt.intK },
      { k: 'repeat', label: 'Repeat order share', f: fmt.pct, type: 'pp' }, { k: 'cust', label: 'Active customers (est.)', f: fmt.intK },
      { k: 'freq', label: 'Orders per customer', f: fmt.num2 }
    ], K, KC, sk, R));

    // New vs returning trend
    const g = gran(R.n), B = makeBuckets(R.ai, R.n, g);
    const nw = sumB(cur.D.newO, B), od = sumB(cur.D.orders, B), rt = Array.from(od, (v, j) => v - nw[j]);
    const nrTable = { caption: 'New vs returning', cols: [{ h: 'Period' }, { h: 'New customers', t: 'int' }, { h: 'Returning customers', t: 'int' }, { h: 'Returning share', t: 'pct' }], rows: B.map((b, j) => ({ v: [b.full, nw[j], rt[j], div(rt[j], od[j])] })) };
    const nrDraw = w => stackChart({
      w, h: 250, labels: B.map(b => b.short), fmtY: fmt.intK, aria: 'New versus returning customers per period',
      series: [{ name: 'New', vals: nw, color: 'var(--c1)' }, { name: 'Returning', vals: rt, color: 'var(--c3)' }],
      tips: j => `<b>${esc(B[j].full)}</b><br><i class="tdot" style="background:var(--c1)"></i>New: ${fmt.int(nw[j])}<br><i class="tdot" style="background:var(--c3)"></i>Returning: ${fmt.int(rt[j])}<br><span class="tmuted">Returning share ${fmt.pct(div(rt[j], od[j]))}</span>`
    });
    parts.push(card({ id: 'cu-nr', title: 'New vs returning customers', sub: 'Customers counted by order; a new customer is a first-ever purchase', actions: granSeg(), body: legend([{ label: 'New', color: 'var(--c1)' }, { label: 'Returning', color: 'var(--c3)' }]) + chartDiv('cu-nr-c', 250), table: nrTable }));
    mounts.push(() => mount('cu-nr-c', nrDraw));

    // Cohorts
    const keys = A.KEYS.map((k, i) => ({ k, i })).filter(x => sel.locOk[x.k.loc] && sel.chOk[x.k.ch]);
    const anchor = A.dayMonth[R.bi], nowMi = A.NMONTH - 1;
    const tp = dParts(A.TODAY), monthFrac = tp.d / A.daysInMonth(tp.y, tp.m);
    const coh = [];
    for (let mi = Math.max(0, anchor - 11); mi <= anchor; mi++) {
      let size = 0;
      keys.forEach(x => { size += A.COH_NEW[x.i * A.NMONTH + mi]; });
      const cells = [], counts = [];
      for (let k = 0; k < 12; k++) {
        const t = mi + k;
        if (t > nowMi || !size) { cells.push(null); counts.push(null); continue; }
        let act = 0;
        keys.forEach(x => {
          const sz = A.COH_NEW[x.i * A.NMONTH + mi];
          if (!sz) return;
          const lab = A.monthLabel[t] % 100, dec = lab === 11 ? 1.12 : 1;
          act += k === 0 ? sz : Math.round(sz * A.retention(x.k.type, k) * A.noise(x.i * 131 + mi, k, 5) * dec * (t === nowMi ? monthFrac : 1));
        });
        cells.push(act / size); counts.push(act);
      }
      const ml = A.monthLabel[mi];
      coh.push({ mi, label: MON[ml % 100] + ' ' + Math.floor(ml / 100), short: MON[ml % 100] + ' ' + String(Math.floor(ml / 100)).slice(2), size, cells, counts });
    }
    const cols = Array.from({ length: 12 }, (_, k) => 'M' + k);
    const cohTable = { caption: 'Cohort retention', cols: [{ h: 'Cohort' }, { h: 'New customers', t: 'int' }].concat(cols.map(c => ({ h: c, t: 'pct' }))), rows: coh.map(c => ({ v: [c.label, c.size].concat(c.cells.map(v => v == null ? NaN : v)) })) };
    const cohDraw = w => heatmap({
      w, cols, aria: 'Monthly cohort retention heatmap', rows: coh.map(c => ({ label: c.label + ' · ' + fmt.intK(c.size), short: c.short, cells: c.cells })),
      tips: (i, j) => {
        const c = coh[i], v = c.cells[j];
        if (v == null) return `<b>${esc(c.label)} cohort · month ${j}</b><br><span class="tmuted">Not reached yet</span>`;
        return `<b>${esc(c.label)} cohort · month ${j}</b><br>${j === 0 ? `${fmt.int(c.size)} new customers` : `${fmt.int(c.counts[j])} of ${fmt.int(c.size)} bought again`}<br>${fmt.pct(v)} active${c.mi + j === nowMi ? '<br><span class="tmuted">Month in progress</span>' : ''}`;
      }
    });
    parts.push(card({ id: 'cu-coh', title: 'Cohort retention', sub: `Customers by first-purchase month (12 cohorts up to ${MONL[A.monthLabel[anchor] % 100]} ${Math.floor(A.monthLabel[anchor] / 100)}) · share who purchase again in each later month`, body: chartDiv('cu-coh-c', 300), table: cohTable,
      foot: 'Darker = higher retention. M0 is the acquisition month (100%). Cohorts follow the location and channel filters; the category filter does not apply to customers.' }));
    mounts.push(() => mount('cu-coh-c', cohDraw));

    // CLV by acquisition channel
    const comboSum = pred => { const o = new Float64Array(NM); for (let ci = 0; ci < NC; ci++) if (pred(COMBOS[ci])) for (let m = 0; m < NM; m++) o[m] += cur.combo[ci * NM + m]; return o; };
    const gS = comboSum(c => c.ch === 0), gE = comboSum(c => c.ch === 1), gM = comboSum(c => c.ch === 2);
    const expOrders = (type, mult) => { let s = 1; for (let k = 1; k < 12; k++) s += A.retention(type, k) * mult; return s; };
    const eNewW = SOURCES.map((s, i) => cur.src[i * 7 + 4] * s.newMult), eNewWs = sum(eNewW);
    const acq = [];
    if (sel.chOk[0] && sel.stores.length) acq.push({ name: 'Store walk-in', newC: gS[4], aov: div(gS[0], gS[2]), gm: div(gS[0] - gS[1], gS[0]), mult: 1, type: 'store', spend: NaN });
    if (sel.chOk[1] && sel.eshops.length) SOURCES.forEach((s, i) => acq.push({ name: s.name, newC: eNewWs ? gE[4] * eNewW[i] / eNewWs : 0, aov: div(gE[0], gE[2]), gm: div(gE[0] - gE[1], gE[0]), mult: s.ret, type: 'eshop', spend: s.paid ? cur.src[i * 7 + 5] : NaN }));
    if (sel.chOk[2] && gM[2] > 0) acq.push({ name: 'Marketplace', newC: gM[4], aov: div(gM[0], gM[2]), gm: div(gM[0] - gM[1], gM[0]), mult: 1, type: 'mkt', spend: NaN });
    acq.forEach(a => { a.orders12 = expOrders(a.type, a.mult); a.clv = a.aov * a.orders12; a.gclv = a.clv * a.gm; a.cac = div(a.spend, a.newC); a.ratio = div(a.gclv, a.cac); });
    const clvTable = { sortable: true, caption: 'Customer lifetime value', cols: [{ h: 'Acquisition channel' }, { h: 'New customers', t: 'int' }, { h: 'First-order AOV', t: 'eur2' }, { h: 'Orders in 12 months', t: 'num' }, { h: '12-month CLV', t: 'eur2' }, { h: 'Gross-margin CLV', t: 'eur2' }, { h: 'CAC', t: 'eur2' }, { h: 'GM CLV : CAC', t: 'x' }],
      rows: acq.map(a => ({ v: [a.name, a.newC, a.aov, a.orders12, a.clv, a.gclv, a.cac, a.ratio] })) };
    const clvDraw = w => hbarChart({
      w, aria: '12-month customer lifetime value by acquisition channel', fmt: fmt.eur,
      rows: acq.map(a => ({ label: a.name, sub: fmt.intK(a.newC) + ' new customers', value: a.clv, color: 'var(--accent)',
        tip: `<b>${esc(a.name)}</b><br>12-month CLV: ${fmt.eur2(a.clv)}<br>Gross margin CLV: ${fmt.eur2(a.gclv)}<br>${fmt.num2(a.orders12)} orders per customer${fin(a.cac) ? `<br>CAC ${fmt.eur2(a.cac)} · ratio ${fmt.x(a.ratio)}` : ''}` }))
    });
    // Frequency distribution
    const m = 1 + lam(R.n), Ccount = div(cur.tot.orders, m), Lm = m - 1;
    const fact = k => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
    const pk = [0, 1, 2, 3].map(k => Math.exp(-Lm) * Math.pow(Lm, k) / fact(k));
    pk.push(Math.max(0, 1 - sum(pk)));
    const fLabels = ['1', '2', '3', '4', '5+'], fCounts = pk.map(p => (fin(Ccount) ? Ccount : 0) * p);
    const fqTable = { caption: 'Purchase frequency', cols: [{ h: 'Orders per customer' }, { h: 'Customers', t: 'int' }, { h: 'Share', t: 'pct' }], rows: fLabels.map((l, i) => ({ v: [l, fCounts[i], pk[i]] })) };
    const fqDraw = w => stackChart({
      w, h: 220, labels: fLabels.map(l => l + (l === '1' ? ' order' : '')), fmtY: fmt.intK, aria: 'Purchase frequency distribution',
      series: [{ name: 'Customers', vals: fCounts, color: 'var(--accent)' }],
      tips: j => `<b>${fLabels[j]} order${j ? 's' : ''} in the period</b><br>${fmt.int(fCounts[j])} customers · ${fmt.pct(pk[j])}`
    });
    parts.push(`<div class="grid g2">${card({ id: 'cu-clv', title: 'Lifetime value by acquisition channel', sub: 'Expected revenue per new customer over 12 months', body: chartDiv('cu-clv-c'), table: clvTable, foot: 'CLV = first-order AOV × expected orders in 12 months (cohort retention curve). CAC = paid media spend ÷ new customers.' })}` +
      card({ id: 'cu-fq', title: 'Purchase frequency', sub: `Customers by number of orders in the period (avg ${fmt.num2(m)})`, body: chartDiv('cu-fq-c', 220), table: fqTable, foot: 'Estimated from orders with a shifted Poisson model; demo data has no customer-level records.' }) + '</div>');
    mounts.push(() => mount('cu-clv-c', clvDraw), () => mount('cu-fq-c', fqDraw));
    return { html: parts.join(''), mounts };
  }

  function pageProducts(R, sel, cur, cmp) {
    const parts = [], mounts = [];
    const gc = group(cur.combo, c => c.cat, 6), gp = cmp ? group(cmp.combo, c => c.cat, 6) : null, tot = cur.tot.rev;
    const catTable = {
      sortable: true, caption: 'Categories',
      cols: [{ h: 'Category', render: (v, row) => `<span class="cname"><i class="dot" style="background:${color(row.ci)}"></i>${esc(v)}</span>` }, { h: 'Revenue', t: 'eur' }, { h: 'Share', t: 'pct' }, { h: 'Orders', t: 'int' }, { h: 'Units', t: 'int' }, { h: 'Margin', t: 'pct' }, { h: 'Return rate', t: 'pct' }, { h: 'Trend', t: 'chg' }],
      rows: CATS.map((c, i) => sel.catOk[i] ? { ci: i, v: [c.name, gc[i][0], div(gc[i][0], tot), gc[i][2], gc[i][3], div(gc[i][0] - gc[i][1], gc[i][0]), div(gc[i][5], gc[i][0]), gp ? chg(gc[i][0], gp[i][0]) : NaN] } : null).filter(Boolean),
      foot: ['Total', tot, tot ? 1 : NaN, cur.tot.orders, cur.tot.units, div(tot - cur.tot.cogs, tot), div(cur.tot.retRev, tot), cmp ? chg(tot, cmp.tot.rev) : NaN]
    };
    addExport('Categories', catTable);
    parts.push(`<section class="card" aria-labelledby="pr-cat-h"><header class="ch"><div class="chl"><h2 id="pr-cat-h">Categories</h2><p>Trend = revenue ${cmpShort()}${R.cmpOk ? '' : ' (not available for this range)'}.</p></div></header>${tableHtml(catTable, 'pr-cat-t')}</section>`);

    const ps = productStats(cur.catMonth), pp = cmp ? productStats(cmp.catMonth) : null;
    const ranked = abc(ps);
    const clsColor = { A: 'var(--c1)', B: 'var(--c3)', C: 'var(--c2)' };
    const counts = { A: 0, B: 0, C: 0 }, revs = { A: 0, B: 0, C: 0 };
    ranked.forEach(s => { counts[s.cls]++; revs[s.cls] += s.rev; });
    const parTable = { caption: 'ABC analysis', cols: [{ h: 'Rank', t: 'int' }, { h: 'Product' }, { h: 'Revenue', t: 'eur' }, { h: 'Share', t: 'pct' }, { h: 'Cumulative', t: 'pct' }, { h: 'Class' }], rows: ranked.map((s, i) => ({ v: [i + 1, s.p.name, s.rev, div(s.rev, tot), s.cum, s.cls] })) };
    const parDraw = w => paretoChart({
      w, h: 270, aria: 'Pareto chart of cumulative revenue share by product',
      items: ranked.map((s, i) => ({ prev: s.prev, cum: s.cum, color: clsColor[s.cls], tip: `<b>${i + 1}. ${esc(s.p.name)}</b><br>${esc(CATS[s.p.cat].name)} · class ${s.cls}<br>${fmt.eur(s.rev)} · ${fmt.pct(div(s.rev, tot))} of revenue<br>Cumulative ${fmt.pct(s.cum)}` }))
    });
    const leg = legend(['A', 'B', 'C'].map(k => ({ label: `${k} · ${counts[k]} products · ${fmt.pct(div(revs[k], tot))}`, color: clsColor[k] })));
    parts.push(card({ id: 'pr-par', title: 'ABC / Pareto', sub: 'Cumulative share of revenue · A = first 80%, B = next 15%, C = last 5%', body: leg + chartDiv('pr-par-c', 270), table: parTable }));
    mounts.push(() => mount('pr-par-c', parDraw));

    const clsOf = {};
    ranked.forEach(s => { clsOf[s.p.idx] = s.cls; });
    const q = ui.prodQ.trim().toLowerCase();
    const prodRows = ps.filter(s => s.rev > 0 || s.units > 0).map(s => ({
      sku: s.p.sku, v: [s.p.sku, s.p.name, CATS[s.p.cat].name, s.units, s.rev, div(s.rev, s.units), div(s.rev - s.cogs, s.rev), div(s.retRev, s.rev), pp ? chg(s.rev, pp[s.p.idx].rev) : NaN, clsOf[s.p.idx] || 'C']
    }));
    const prodTable = {
      sortable: true, caption: 'Products',
      cols: [{ h: 'SKU', render: v => `<span class="mono">${esc(v)}</span>` }, { h: 'Product' }, { h: 'Category' }, { h: 'Units', t: 'int' }, { h: 'Revenue', t: 'eur' }, { h: 'Avg price', t: 'eur2' }, { h: 'Margin', t: 'pct' }, { h: 'Return rate', t: 'pct' }, { h: 'Trend', t: 'chg' }, { h: 'ABC', render: v => `<span class="abc abc-${v}">${v}</span>` }],
      rows: prodRows
    };
    addExport('Products', prodTable);
    if (!ui.sort['pr-p-t']) ui.sort['pr-p-t'] = { c: 4, d: -1 };
    const filtered = () => Object.assign({}, prodTable, { rows: q ? prodRows.filter(r => (r.v[0] + ' ' + r.v[1] + ' ' + r.v[2]).toLowerCase().includes(q)) : prodRows });
    parts.push(`<section class="card" aria-labelledby="pr-p-h"><header class="ch"><div class="chl"><h2 id="pr-p-h">Products</h2><p>${prodRows.length} products with sales · margin and returns allocated from category totals</p></div><div class="cact"><label class="sr" for="prodQ">Search products</label><input id="prodQ" class="search" type="search" placeholder="Search products" value="${esc(ui.prodQ)}" autocomplete="off"></div></header><div id="prodTableWrap">${tableHtml(filtered(), 'pr-p-t')}</div></section>`);
    mounts.push(() => {
      const inp = $('prodQ');
      if (inp) inp.addEventListener('input', () => {
        ui.prodQ = inp.value;
        const qq = ui.prodQ.trim().toLowerCase();
        $('prodTableWrap').innerHTML = tableHtml(Object.assign({}, prodTable, { rows: qq ? prodRows.filter(r => (r.v[0] + ' ' + r.v[1] + ' ' + r.v[2]).toLowerCase().includes(qq)) : prodRows }), 'pr-p-t');
      });
    });
    return { html: parts.join(''), mounts };
  }

  // ── Anomaly detection ───────────────────────────────────────────────────────
  // Daily: each slice's revenue vs the median of the same weekday over the previous 8 weeks
  // (robust z = deviation ÷ max(1.4826·MAD, floor)). Weekly: rolling 7-day blocks vs the previous
  // 8 blocks. Returns: 7-day return rate vs previous 8 blocks. ROAS: 7-day attributed revenue ÷
  // spend per e-shop and paid source vs previous 8 blocks. Holidays (drops) and promotions (spikes)
  // are kept but marked "expected".
  const SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
  const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low', info: 'Expected' };
  const median = a => { const b = a.filter(fin).sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; };
  function robust(vals, floorAbs, floorRel) {
    const m = median(vals), mad = median(vals.map(v => Math.abs(v - m))) * 1.4826;
    return { m, s: Math.max(fin(mad) ? mad : 0, floorAbs, Math.abs(m) * floorRel) };
  }
  const sevOf = z => { const a = Math.abs(z); return a >= 6 ? 'high' : a >= 4.5 ? 'medium' : 'low'; };
  const alCache = new Map();
  function detectAlerts(endIdx, W, sel) {
    const key = endIdx + '|' + W + '|' + Array.from(sel.combos).join(',') + '|' + sel.chOk.join();
    if (alCache.has(key)) return alCache.get(key);
    const out = [], nb = Math.max(1, Math.floor(W / 7));
    const start = endIdx - W + 1, base0 = Math.max(0, Math.min(start - 56, endIdx - 7 * (nb + 8) + 1)), len = endIdx - base0 + 1;
    const cbs = Array.from(sel.combos), REV = {}, RET = {}, RU = {};
    cbs.forEach(ci => {
      const r = new Float64Array(len), t = new Float64Array(len), u = new Float64Array(len);
      for (let k = 0; k < len; k++) { const b = ((base0 + k) * NC + ci) * NM; r[k] = S[b]; t[k] = S[b + 5]; u[k] = S[b + 6]; }
      REV[ci] = r; RET[ci] = t; RU[ci] = u;
    });
    const sumS = (list, M) => { const o = new Float64Array(len); list.forEach(ci => { const a = M[ci]; for (let k = 0; k < len; k++) o[k] += a[k]; }); return o; };
    const blk = (y, kEnd) => { let s0 = 0; for (let k = kEnd - 6; k <= kEnd; k++) s0 += k >= 0 ? y[k] : NaN; return s0; };
    const win = (dn, back, fwd) => ({ r: 'custom', f: A.iso(Math.max(A.START, dn - back)), t: A.iso(Math.min(A.TODAY, dn + fwd)), g: 'day' });
    const slices = [];
    selLocs(sel).forEach(li => {
      const L = LOCS[li], c0 = locCombos(sel, li);
      slices.push({ lvl: 'agg', label: L.name, countries: [L.country], combos: c0, patch: { l: L.id, co: 'all' }, li });
      c0.forEach(ci => {
        const cb = COMBOS[ci];
        if (cb.cat === 5 || cb.cat === 3) return; // exams & solutions: too small for daily alerts
        slices.push({ lvl: 'combo', label: `${L.name} · ${CATS[cb.cat].name}${cb.ch ? ' (' + CHANNELS[cb.ch].name + ')' : ''}`, countries: [L.country], combos: [ci], patch: { l: L.id, co: 'all', cat: CATS[cb.cat].id, ch: CHANNELS[cb.ch].id }, li, ci });
      });
    });
    const allCountries = [...new Set(selLocs(sel).map(li => LOCS[li].country))];
    CATS.forEach((c, i) => { const c0 = cbs.filter(ci => CCAT[ci] === i); if (c0.length && st.cat === 'all') slices.push({ lvl: 'agg', label: c.name + ' (all locations)', countries: allCountries, combos: c0, patch: { cat: c.id } }); });
    CHANNELS.forEach((c, i) => { const c0 = cbs.filter(ci => CCH[ci] === i); if (c0.length && st.ch === 'all') slices.push({ lvl: 'agg', label: c.name + ' channel', countries: allCountries, combos: c0, patch: { ch: c.id } }); });

    slices.forEach(sl => {
      const y = sumS(sl.combos, REV), combo = sl.lvl === 'combo';
      // daily
      for (let t = Math.max(start, base0 + 56); t <= endIdx; t++) {
        const k = t - base0, x = y[k], dn = A.START + t, base = [];
        for (let j = 1; j <= 8; j++) base.push(y[k - 7 * j]);
        const { m, s } = robust(base, combo ? 150 : 100, combo ? 0.25 : 0.12);
        const minM = combo ? 400 : 250;
        if (m < minM && x < 3 * minM) continue;
        const z = (x - m) / s, dev = x - m;
        if (Math.abs(z) < (combo ? 4 : 3.2) || Math.abs(dev) < (combo ? Math.max(1000, 0.8 * m) : Math.max(400, 0.3 * m))) continue;
        const p = dParts(dn), hol = sl.countries.filter(c => A.isHoliday(c, dn)), promo = A.PROMOS.filter(q => q.a <= dn && q.b >= dn).map(q => q.name);
        let ctx = '';
        if (dev < 0 && hol.length) ctx = 'Public holiday (' + hol.join(', ') + ')';
        else if (dev < 0 && p.m === 11 && (p.d === 24 || p.d === 31)) ctx = 'Short opening hours (' + (p.d === 24 ? 'Christmas Eve' : "New Year's Eve") + ')';
        else if (dev > 0 && promo.length) ctx = 'Promotion: ' + promo.join(', ');
        out.push({
          sev: ctx ? 'info' : sevOf(z), kind: 'revenue', dn, dn0: dn, label: sl.label, z, li: sl.li, lvl: sl.lvl, sign: Math.sign(dev),
          title: `Revenue ${dev > 0 ? 'spike' : 'drop'}: ${fmt.pct0(Math.abs(dev) / Math.max(1, m))} ${dev > 0 ? 'above' : 'below'} a typical ${WD[p.wd]}`,
          detail: `${fmt.eur(x)} vs typical ${fmt.eur(m)} (median of the previous 8 ${WD[p.wd]}s) · z ${z.toFixed(1)}`, ctx,
          patch: Object.assign(win(dn, 27, 7), sl.patch), page: 'overview'
        });
      }
      // weekly (aggregate slices only)
      if (!combo) {
        for (let bk = 0; bk < nb; bk++) {
          const kEnd = endIdx - base0 - 7 * bk;
          if (kEnd - 7 * 8 - 6 < 0) break;
          const x = blk(y, kEnd), base = [];
          for (let j = 1; j <= 8; j++) base.push(blk(y, kEnd - 7 * j));
          const { m, s } = robust(base, 300, 0.06), z = (x - m) / s, dev = x - m;
          if (m < 2000 || Math.abs(z) < 3.5 || Math.abs(dev) < Math.max(1500, 0.2 * m)) continue;
          const dn = A.START + base0 + kEnd, promo = A.PROMOS.filter(q => q.a <= dn && q.b >= dn - 6).map(q => q.name);
          const hol = []; for (let q = dn - 6; q <= dn; q++) sl.countries.forEach(c => { if (A.isHoliday(c, q) && !hol.includes(c)) hol.push(c); });
          const ctx = dev > 0 && promo.length ? 'Promotion: ' + promo.join(', ') : dev < 0 && hol.length ? 'Includes public holidays (' + hol.join(', ') + ')' : '';
          out.push({
            sev: ctx ? 'info' : sevOf(z), kind: 'revenue', dn, dn0: dn - 6, label: sl.label, z, li: sl.li, lvl: 'week', sign: Math.sign(dev),
            title: `Weekly revenue ${dev > 0 ? 'up' : 'down'} ${fmt.pct0(Math.abs(dev) / m)} vs the previous 8 weeks`,
            detail: `${fmt.eur(x)} in 7 days to ${dLabel(dn)} vs typical ${fmt.eur(m)} · z ${z.toFixed(1)}`, ctx,
            patch: Object.assign(win(dn, 55, 7), sl.patch, { g: 'week' }), page: 'overview'
          });
        }
      }
      // return-rate spikes (locations and location × category)
      if (sl.li != null) {
        const rr = sumS(sl.combos, RET), ru = sumS(sl.combos, RU);
        for (let bk = 0; bk < nb; bk++) {
          const kEnd = endIdx - base0 - 7 * bk;
          if (kEnd - 7 * 8 - 6 < 0) break;
          const rv = blk(y, kEnd), rt = blk(rr, kEnd), units = blk(ru, kEnd), x = div(rt, rv), base = [];
          for (let j = 1; j <= 8; j++) base.push(div(blk(rr, kEnd - 7 * j), blk(y, kEnd - 7 * j)));
          const { m, s } = robust(base, 0.01, 0.25);
          if (!fin(x) || !fin(m) || rv < 800 || units < 4 || x < m + 3 * s || x < 1.8 * m) continue;
          const z = (x - m) / s, dn = A.START + base0 + kEnd;
          out.push({
            sev: sevOf(z), kind: 'returns', dn, dn0: dn - 6, label: sl.label, z, li: sl.li, lvl: sl.lvl, sign: 1,
            title: `Return-rate spike: ${fmt.pct(x)} vs usual ${fmt.pct(m)}`,
            detail: `${fmt.int(units)} units (${fmt.eur(rt)}) returned in 7 days to ${dLabel(dn)} on ${fmt.eur(rv)} sales · z ${z.toFixed(1)}`, ctx: '',
            patch: Object.assign(win(dn, 55, 7), sl.patch, { g: 'week' }), page: 'products'
          });
        }
      }
    });
    // ROAS drops per e-shop and paid source (Google Ads, Meta)
    if (sel.chOk[1]) {
      selLocs(sel).filter(li => LOCS[li].type === 'eshop').forEach(li => {
        const e = ESHOP_POS[li], ec = cbs.filter(ci => CLOC[ci] === li && CCH[ci] === 1);
        if (!ec.length) return;
        const y = sumS(ec, REV);
        [0, 1].forEach(sIdx => {
          const sp = new Float64Array(len), rv = new Float64Array(len);
          for (let k = 0; k < len; k++) {
            const fb0 = ((base0 + k) * NE + e) * NSRC * 6;
            let tot = 0;
            for (let q = 0; q < NSRC; q++) tot += FUN[fb0 + q * 6 + 4];
            sp[k] = FUN[fb0 + sIdx * 6 + 5]; rv[k] = tot ? y[k] * FUN[fb0 + sIdx * 6 + 4] / tot : 0;
          }
          for (let bk = 0; bk < nb; bk++) {
            const kEnd = endIdx - base0 - 7 * bk;
            if (kEnd - 7 * 8 - 6 < 0) break;
            const spend = blk(sp, kEnd), x = div(blk(rv, kEnd), spend), base = [];
            for (let j = 1; j <= 8; j++) base.push(div(blk(rv, kEnd - 7 * j), blk(sp, kEnd - 7 * j)));
            const { m, s } = robust(base, 0.1, 0.08);
            if (!fin(x) || !fin(m) || spend < 300 || x > m - 3 * s || x > 0.75 * m) continue;
            const z = (x - m) / s, dn = A.START + base0 + kEnd;
            out.push({
              sev: sevOf(z), kind: 'roas', dn, dn0: dn - 6, label: `${LOCS[li].name} · ${SOURCES[sIdx].name}`, z, li, lvl: 'roas', sign: -1,
              title: `ROAS drop: ${fmt.x(x)} vs usual ${fmt.x(m)}`,
              detail: `${fmt.eur(spend)} spend, ${fmt.eur(blk(rv, kEnd))} attributed revenue in 7 days to ${dLabel(dn)} · z ${z.toFixed(1)}`, ctx: '',
              patch: Object.assign(win(dn, 55, 7), { l: LOCS[li].id, co: 'all', ch: 'eshop', g: 'day' }), page: 'ecommerce'
            });
          }
        });
      });
    }
    // Drop a location × category alert when its location already has a same-day alert in the same direction.
    const locDay = new Set(out.filter(a => a.lvl === 'agg' && a.li != null).map(a => a.li + '|' + a.dn + '|' + a.sign));
    const res = out.filter(a => !(a.lvl === 'combo' && a.kind === 'revenue' && locDay.has(a.li + '|' + a.dn + '|' + a.sign)))
      .sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || b.dn - a.dn || Math.abs(b.z) - Math.abs(a.z)).slice(0, 300);
    if (alCache.size > 40) alCache.clear();
    alCache.set(key, res);
    return res;
  }
  const alertHref = a => hashFor(a.page, '', sanitize(Object.assign({}, st, a.patch)));
  const sevBadge = sev => `<span class="sev sev-${sev}">${SEV_LABEL[sev]}</span>`;

  function pageAlerts(R, sel) {
    const W = +st.aw, all = detectAlerts(R.bi, W, sel);
    const kinds = { revenue: 'Revenue', returns: 'Returns', roas: 'ROAS' };
    const list = all.filter(a => (st.ak === 'all' || a.kind === st.ak) && (ui.showExpected || a.sev !== 'info'));
    const cnt = k => all.filter(a => a.sev === k && (st.ak === 'all' || a.kind === st.ak)).length;
    const tiles = ['high', 'medium', 'low', 'info'].map(k => `<article class="kpi"><div class="l">${SEV_LABEL[k]}</div><div class="v">${cnt(k)}</div><div class="d"><span class="muted">${k === 'info' ? 'holidays & promotions' : k === 'high' ? '|z| ≥ 6' : k === 'medium' ? '|z| 4.5–6' : 'smaller deviations'}</span></div></article>`).join('');
    const seg = (attr, cur, opts, label) => `<div class="seg sm" role="group" aria-label="${label}">${opts.map(o => `<button type="button" ${attr}="${o[0]}" aria-pressed="${cur === o[0]}">${o[1]}</button>`).join('')}</div>`;
    const actions = seg('data-aw', st.aw, [['28', '28 days'], ['56', '56 days'], ['90', '90 days']], 'Scan window') +
      seg('data-ak', st.ak, [['all', 'All'], ['revenue', 'Revenue'], ['returns', 'Returns'], ['roas', 'ROAS']], 'Alert type') +
      `<button type="button" class="btn sm ${ui.showExpected ? '' : 'ghost'}" data-exp aria-pressed="${!!ui.showExpected}">Show expected</button>`;
    const table = {
      caption: 'Alerts',
      cols: [{ h: 'Severity', render: v => sevBadge(v) }, { h: 'Date', render: (v, row) => `<span class="mono">${esc(row.when)}</span>` }, { h: 'Type' }, { h: 'Where', render: v => `<span class="name w1">${esc(v)}</span>` },
        { h: 'What happened', render: (v, row) => `<span class="name w2">${esc(v)}<small>${esc(row.detail)}${row.ctx ? ' · ' + esc(row.ctx) : ''}</small></span>` }, { h: 'z-score', t: 'num' }, { h: '', render: (v, row) => `<a class="tlink" href="${row.href}">View slice →</a>` }],
      rows: list.map(a => ({ when: a.dn0 === a.dn ? A.iso(a.dn) : A.iso(a.dn0) + ' – ' + A.iso(a.dn).slice(5), detail: a.detail, ctx: a.ctx, href: alertHref(a), v: [a.sev, A.iso(a.dn), kinds[a.kind], a.label, a.title, a.z, ''] }))
    };
    addExport('Alerts', { cols: [{ h: 'Severity' }, { h: 'From' }, { h: 'To' }, { h: 'Type' }, { h: 'Where' }, { h: 'What happened' }, { h: 'Detail' }, { h: 'Context' }, { h: 'z-score', t: 'num' }],
      rows: list.map(a => ({ v: [SEV_LABEL[a.sev], A.iso(a.dn0), A.iso(a.dn), kinds[a.kind], a.label, a.title, a.detail, a.ctx, a.z] })) });
    const note = 'Daily: revenue vs the median of the same weekday over the previous 8 weeks. Weekly and return-rate / ROAS checks: rolling 7-day blocks vs the previous 8 blocks. z = deviation ÷ robust spread (1.4826 × median absolute deviation, with a floor). Holiday drops and promotion spikes are marked Expected.';
    return {
      html: `<section class="kpis" aria-label="Alert counts">${tiles}</section>` +
        `<section class="card" aria-labelledby="al-h"><header class="ch"><div class="chl"><h2 id="al-h">Alerts</h2><p>${list.length} alert${list.length === 1 ? '' : 's'} in the ${W} days to ${esc(dLabel(R.b))} · follows the location, channel and category filters · “View slice” sets the filters to that slice</p></div><div class="cact">${actions}</div></header>` +
        (list.length ? tableHtml(table, 'al-t') : '<p class="empty">No unusual days or weeks for these filters. Try a longer window or “Show expected”.</p>') + `<p class="cfoot">${esc(note)}</p></section>`,
      mounts: []
    };
  }

  // ── Targets & forecast page ─────────────────────────────────────────────────
  function pageTargets(R, sel, cur, cmp) {
    const parts = [], mounts = [];
    const F = forecastSlice(sel, 90), f90 = fcSum(F, 1, 90);
    const extra = `<article class="kpi tgt" title="Sum of the daily forecast for the next 90 days"><div class="l">Next 90 days forecast</div><div class="v">${esc(fmt.eurK(f90.v))}</div><div class="d"><span class="muted">80% range ${fmt.eurK(f90.lo)} – ${fmt.eurK(f90.hi)}</span></div></article>`;
    parts.push(`<div class="pagebar"><p>Targets default to the same month last year +${esc(fmt.num1(targets.growth))}% per location (margin: last year +${esc(fmt.num1(targets.marginPP))} pp). Edits are saved in this browser. With a channel or category filter, each location's target is scaled by that slice's share of its revenue last year.</p><button type="button" class="btn" data-act="edit-targets"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>Edit targets</button></div>`);
    parts.push(targetTiles(R, sel, cur, { link: false, extra }));
    const tr = trendCard('tg-trend', R, cur, cmp, 'rev', { title: 'Revenue: actual, target and forecast', sel });
    parts.push(tr.html); mounts.push(tr.mount);

    // Variance by location
    const gl = group(cur.combo, c => c.loc, NL);
    const locRows = selLocs(sel).map(li => {
      const t = targetTotal(sel, R.ai, R.bi, [li]), a = gl[li][0], gm = div(a - gl[li][1], a);
      return { v: [LOCS[li].name, LOCS[li].country, a, t.rev, a - t.rev, chg(a, t.rev), gm, div(t.gp, t.rev), div(a, t.rev)] };
    });
    const T = targetTotal(sel, R.ai, R.bi), A0 = cur.tot.rev;
    const varT = { sortable: true, caption: 'Variance by location', cols: [{ h: 'Location' }, { h: 'Country' }, { h: 'Actual', t: 'eur' }, { h: 'Target', t: 'eur' }, { h: 'Variance €', t: 'eur' }, { h: 'Variance %', t: 'chg' }, { h: 'GM actual', t: 'pct' }, { h: 'GM target', t: 'pct' }, { h: 'Attainment', t: 'pct' }],
      rows: locRows, foot: ['Total', '', A0, T.rev, A0 - T.rev, chg(A0, T.rev), div(A0 - cur.tot.cogs, A0), div(T.gp, T.rev), div(A0, T.rev)] };
    if (!ui.sort['tg-loc-t']) ui.sort['tg-loc-t'] = { c: 8, d: -1 };
    addExport('Variance by location', varT);
    parts.push(`<section class="card" aria-labelledby="tg-loc-h"><header class="ch"><div class="chl"><h2 id="tg-loc-h">Variance by location</h2><p>${esc(rangeLabel(R.a, R.b))} · actual vs target for the filtered slice${fin(T.rev) ? '' : ' · part of this range has no target (no prior-year data)'}</p></div></header>${tableHtml(varT, 'tg-loc-t')}</section>`);

    // Variance by month (within range)
    const ts = targetSeries(sel, R.ai, R.bi);
    const mrows = [];
    for (let mi = mIdx(R.a); mi <= mIdx(R.b); mi++) {
      const d0 = Math.max(mStart(mi) - A.START, R.ai), d1 = Math.min(mEnd(mi) - A.START, R.bi);
      let a = 0, c = 0;
      for (let d = d0; d <= d1; d++) { a += cur.D.rev[d - R.ai]; c += cur.D.cogs[d - R.ai]; }
      const t = sumF(ts.rev.slice(d0 - R.ai, d1 - R.ai + 1)), gp = sumF(ts.gp.slice(d0 - R.ai, d1 - R.ai + 1));
      const partial = d0 > mStart(mi) - A.START || d1 < mEnd(mi) - A.START;
      mrows.push({ v: [mName(mi) + (partial ? ' (' + rangeLabel(A.START + d0, A.START + d1) + ')' : ''), a, t, a - t, chg(a, t), div(a - c, a), div(gp, t)] });
    }
    const mT = { caption: 'Variance by month', cols: [{ h: 'Month' }, { h: 'Actual', t: 'eur' }, { h: 'Target', t: 'eur' }, { h: 'Variance €', t: 'eur' }, { h: 'Variance %', t: 'chg' }, { h: 'GM actual', t: 'pct' }, { h: 'GM target', t: 'pct' }],
      rows: mrows, foot: ['Total', A0, T.rev, A0 - T.rev, chg(A0, T.rev), div(A0 - cur.tot.cogs, A0), div(T.gp, T.rev)] };
    addExport('Variance by month', mT);

    // Forecast by month
    const frows = [], nowMi = mIdx(A.TODAY), lastMi = mIdx(A.TODAY + 90), y = sliceDaily(Array.from(sel.combos)).rev;
    for (let mi = nowMi; mi <= lastMi; mi++) {
      const ms = mStart(mi) - A.START, me = mEnd(mi) - A.START, cov = Math.min(me, TI + 90);
      let act = 0;
      for (let d = ms; d <= Math.min(TI, me); d++) act += y[d];
      const part = fcSum(F, Math.max(1, ms - TI), cov - TI), tgt = targetTotal(sel, ms, cov).rev;
      frows.push({ v: [mName(mi) + (cov < me ? ' (to ' + dLabel(A.START + cov, false) + ')' : ''), mi === nowMi ? act : NaN, part.v, act + part.v, act + part.lo, act + part.hi, tgt, chg(act + part.v, tgt)] });
    }
    const fT = { caption: 'Forecast by month', cols: [{ h: 'Month' }, { h: 'Actual to date', t: 'eur' }, { h: 'Forecast (remaining)', t: 'eur' }, { h: 'Projected total', t: 'eur' }, { h: 'Low (80%)', t: 'eur' }, { h: 'High (80%)', t: 'eur' }, { h: 'Target', t: 'eur' }, { h: 'Projected vs target', t: 'chg' }], rows: frows };
    addExport('Forecast by month', fT);
    parts.push(`<div class="grid g2"><section class="card" aria-labelledby="tg-m-h"><header class="ch"><div class="chl"><h2 id="tg-m-h">Variance by month</h2><p>Months in the selected range</p></div></header>${tableHtml(mT, 'tg-m-t')}</section>` +
      `<section class="card" aria-labelledby="tg-f-h"><header class="ch"><div class="chl"><h2 id="tg-f-h">Forecast by month</h2><p>Next 90 days for the filtered slice · forecast kept separate from actuals</p></div></header>${tableHtml(fT, 'tg-f-t')}` +
      `<p class="cfoot">Method: per location, a weighted moving average of the last 28 days (weekday effects removed) × last year's seasonal shape (7-day average 364 days earlier) × weekday factors from the last 8 weeks; stores close on public holidays. The 80% band combines day-to-day noise with a level uncertainty that grows with the horizon.</p></section></div>`);
    return { html: parts.join(''), mounts };
  }

  // ── Monthly report ──────────────────────────────────────────────────────────
  function pageReport(sel) {
    const nowMi = mIdx(A.TODAY);
    let mi = st.m ? keyToMi(st.m) : nowMi - 1;
    mi = Math.min(nowMi, Math.max(0, mi));
    const a = Math.max(mStart(mi), A.START), b = Math.min(mEnd(mi), A.TODAY), n = b - a + 1, mtd = b < mEnd(mi);
    const rng = (m0) => { if (m0 < 0) return null; const s0 = mStart(m0); if (s0 < A.START) return null; const e0 = mtd ? Math.min(mEnd(m0), s0 + n - 1) : mEnd(m0); return [s0, e0]; };
    const cur = compute(a - A.START, b - A.START, sel), pr = rng(mi - 1), lr = rng(mi - 12);
    ui.reportPeriod = { a, b, pr, lr };
    const pm = pr ? compute(pr[0] - A.START, pr[1] - A.START, sel) : null, ly = lr ? compute(lr[0] - A.START, lr[1] - A.START, sel) : null;
    const tg = targetTotal(sel, a - A.START, b - A.START);
    const ext = t => Object.assign(kpis(t), { sessions: t.sessions, spend: t.spend, cpa: div(t.spend, t.eOrders) });
    const K = ext(cur.tot), KP = pm ? ext(pm.tot) : null, KL = ly ? ext(ly.tot) : null;
    const rowsDef = [['Revenue', 'rev', 'eur'], ['Gross margin', 'gm', 'pct', 'pp'], ['Orders', 'orders', 'int'], ['Avg order value', 'aov', 'eur2'], ['Units sold', 'units', 'int'],
      ['Return rate', 'rr', 'pct', 'pp', true], ['New customers', 'newC', 'int'], ['E-shop sessions', 'sessions', 'int'], ['E-shop conversion', 'cr', 'pct2', 'pp'], ['Marketing spend', 'spend', 'eur', '', true], ['ROAS (blended)', 'roas', 'x']];
    const tgtOf = { rev: tg.rev, gm: div(tg.gp, tg.rev) };
    const dCell = (v, p, type) => type === 'pp' ? (fin(v) && fin(p) ? (v - p) * 100 : NaN) : chg(v, p);
    const kT = {
      caption: 'Key figures',
      cols: [{ h: 'Metric' }, { h: 'Actual', t: 'num', render: (v, row) => row.f(v) }, { h: 'Prev. month', t: 'num', render: (v, row) => row.f(v) }, { h: 'Δ', t: 'num', render: (v, row) => row.dfmt(v, 0) },
        { h: 'Last year', t: 'num', render: (v, row) => row.f(v) }, { h: 'Δ', t: 'num', render: (v, row) => row.dfmt(v, 1) }, { h: 'Target', t: 'num', render: (v, row) => row.f(v) }, { h: 'Δ', t: 'num', render: (v, row) => row.dfmt(v, 2) }],
      rows: rowsDef.map(([label, k, t, type, inv]) => {
        const f = TYPES[t].f, v = K[k], p = KP ? KP[k] : NaN, l = KL ? KL[k] : NaN, tv = k in tgtOf ? tgtOf[k] : NaN;
        const raw = [label, v, p, dCell(v, p, type), l, dCell(v, l, type), tv, dCell(v, tv, type)];
        return { f, v: raw, dfmt: (dv, i) => { const ref = [p, l, tv][i]; return fin(dv) ? deltaHtml(v, ref, type === 'pp' ? 'pp' : 'rel', inv) : '<span class="delta flat">—</span>'; } };
      })
    };
    addExport('Key figures', { cols: [{ h: 'Metric' }, { h: 'Actual', t: 'num' }, { h: 'Prev. month', t: 'num' }, { h: 'Δ prev. (% or pp)', t: 'num' }, { h: 'Last year', t: 'num' }, { h: 'Δ LY (% or pp)', t: 'num' }, { h: 'Target', t: 'num' }, { h: 'Δ target (% or pp)', t: 'num' }],
      rows: kT.rows.map((r, i) => { const pct = rowsDef[i][2].startsWith('pct'); const sc = v => fin(v) ? (pct ? v * 100 : v) : NaN; const dd = v => fin(v) ? (rowsDef[i][3] === 'pp' ? v : v * 100) : NaN; return { v: [r.v[0], sc(r.v[1]), sc(r.v[2]), dd(r.v[3]), sc(r.v[4]), dd(r.v[5]), sc(r.v[6]), dd(r.v[7])] }; }) });

    // Locations
    const gl = group(cur.combo, c => c.loc, NL), gly = ly ? group(ly.combo, c => c.loc, NL) : null;
    const locs = selLocs(sel).map(li => { const t = targetTotal(sel, a - A.START, b - A.START, [li]).rev; return { li, name: LOCS[li].name, act: gl[li][0], ly: gly ? gly[li][0] : NaN, t, att: div(gl[li][0], t), yoy: gly ? chg(gl[li][0], gly[li][0]) : NaN }; });
    const rankKey = locs.some(x => fin(x.att)) ? 'att' : 'yoy';
    const ranked = locs.filter(x => fin(x[rankKey])).sort((p, q) => q[rankKey] - p[rankKey]);
    const top = ranked.slice(0, 3), bottom = ranked.slice(-3).reverse().filter(x => !top.includes(x));
    const locT = list => ({ caption: 'Locations', cols: [{ h: 'Location' }, { h: 'Revenue', t: 'eur' }, { h: 'YoY', t: 'chg' }, { h: 'Target', t: 'eur' }, { h: 'Attainment', t: 'pct' }], rows: list.map(x => ({ v: [x.name, x.act, x.yoy, x.t, x.att] })) });
    addExport('Locations', locT(locs));
    // Categories
    const gc = group(cur.combo, c => c.cat, 6), gcl = ly ? group(ly.combo, c => c.cat, 6) : null;
    const cats = CATS.map((c, i) => ({ i, name: c.name, rev: gc[i][0], share: div(gc[i][0], cur.tot.rev), yoy: gcl ? chg(gc[i][0], gcl[i][0]) : NaN, gm: div(gc[i][0] - gc[i][1], gc[i][0]) })).filter(x => sel.catOk[x.i] && x.rev > 0);
    const catT = { caption: 'Category mix', cols: [{ h: 'Category' }, { h: 'Revenue', t: 'eur' }, { h: 'Share', t: 'pct' }, { h: 'YoY', t: 'chg' }, { h: 'Margin', t: 'pct' }], rows: cats.map(x => ({ v: [x.name, x.rev, x.share, x.yoy, x.gm] })), foot: ['Total', cur.tot.rev, cur.tot.rev ? 1 : NaN, ly ? chg(cur.tot.rev, ly.tot.rev) : NaN, K.gm] };
    addExport('Category mix', catT);
    // Marketing
    const srcs = SOURCES.map((s0, i) => ({ name: s0.name, spend: cur.src[i * 7 + 5], rev: cur.src[i * 7 + 6], orders: cur.src[i * 7 + 4] }));
    const mkT = { caption: 'Marketing efficiency', cols: [{ h: 'Source' }, { h: 'Spend', t: 'eur' }, { h: 'Revenue', t: 'eur' }, { h: 'ROAS', t: 'x' }, { h: 'CPA', t: 'eur2' }],
      rows: srcs.map(x => ({ v: [x.name, x.spend, x.rev, x.spend ? div(x.rev, x.spend) : NaN, x.spend ? div(x.spend, x.orders) : NaN] })), foot: ['All sources', cur.tot.spend, cur.tot.eRev, div(cur.tot.eRev, cur.tot.spend), div(cur.tot.spend, cur.tot.fOrders)] };
    if (sel.eshops.length) addExport('Marketing efficiency', mkT);
    // Alerts in the month
    const al = detectAlerts(b - A.START, n, sel).filter(x => x.sev !== 'info' && x.dn >= a).slice(0, 6);
    addExport('Notable alerts', { cols: [{ h: 'Severity' }, { h: 'Date' }, { h: 'Where' }, { h: 'What happened' }], rows: al.map(x => ({ v: [SEV_LABEL[x.sev], A.iso(x.dn), x.label, x.title] })) });

    // Commentary
    const pctTxt = v => fin(v) ? (v >= 0 ? 'up ' : 'down ') + NF1.format(Math.abs(v * 100)) + '%' : null;
    const lines = [];
    const vsLy = ly ? pctTxt(chg(K.rev, KL.rev)) : null, vsPm = pm ? pctTxt(chg(K.rev, KP.rev)) : null;
    lines.push(`Revenue ${mtd ? 'month to date ' : ''}was ${fmt.eur(K.rev)}` + (vsLy ? `, ${vsLy} on ${mName(mi - 12)}` : '') + (vsPm ? ` and ${vsPm} on ${mName(mi - 1)}${mtd ? ' (same days)' : ''}` : '') + '.');
    if (fin(tg.rev)) lines.push(`That is ${fmt.pct0(div(K.rev, tg.rev))} of target, ${K.rev >= tg.rev ? 'ahead by' : 'short by'} ${fmt.eur(Math.abs(K.rev - tg.rev))}.`);
    if (KL && fin(K.gm) && fin(KL.gm)) lines.push(`Gross margin ${K.gm >= KL.gm ? 'improved' : 'slipped'} ${NF1.format(Math.abs(K.gm - KL.gm) * 100)} pp year on year to ${fmt.pct(K.gm)}${fin(tgtOf.gm) ? ` (target ${fmt.pct(tgtOf.gm)})` : ''}.`);
    if (top.length && bottom.length) lines.push(`Strongest location: ${top[0].name} (${rankKey === 'att' ? fmt.pct0(top[0].att) + ' of target' : pctTxt(top[0].yoy) + ' YoY'}); weakest: ${bottom[0].name} (${rankKey === 'att' ? fmt.pct0(bottom[0].att) + ' of target' : pctTxt(bottom[0].yoy) + ' YoY'}).`);
    if (cats.length) {
      const big = cats.slice().sort((p, q) => q.rev - p.rev)[0], grow = cats.filter(x => fin(x.yoy)).sort((p, q) => q.yoy - p.yoy)[0];
      lines.push(`${big.name} was the largest category (${fmt.pct(big.share)} of revenue)` + (grow && cats.length > 1 ? `; fastest growth: ${grow.name} (${pctTxt(grow.yoy)} YoY).` : '.'));
    }
    if (sel.eshops.length && cur.tot.spend > 0) lines.push(`Blended ROAS was ${fmt.x(K.roas)} on ${fmt.eur(cur.tot.spend)} marketing spend (Google Ads ${fmt.x(div(srcs[0].rev, srcs[0].spend))}, Meta ${fmt.x(div(srcs[1].rev, srcs[1].spend))}).`);
    if (fin(K.rr)) lines.push(`Return rate ${fmt.pct(K.rr)}${KL && fin(KL.rr) ? ` (${K.rr >= KL.rr ? '+' : MINUS}${NF1.format(Math.abs(K.rr - KL.rr) * 100)} pp vs last year)` : ''}.`);
    lines.push(al.length ? `${al.length} notable alert${al.length > 1 ? 's' : ''}; most notable: ${al[0].title.charAt(0).toLowerCase() + al[0].title.slice(1)} at ${al[0].label} (${dLabel(al[0].dn0)}${al[0].dn0 !== al[0].dn ? ' – ' + dLabel(al[0].dn) : ''}).` : 'No unusual days or weeks were detected.');
    addExport('Commentary', { cols: [{ h: 'Commentary' }], rows: lines.map(l => ({ v: [l] })) });

    const opts = [];
    for (let m0 = nowMi; m0 >= 0; m0--) opts.push(`<option value="${mKey(m0)}"${m0 === mi ? ' selected' : ''}>${mName(m0)}${m0 === nowMi ? ' (month to date)' : ''}</option>`);
    const sub = (t, body) => `<section class="rsec"><h3>${esc(t)}</h3>${body}</section>`;
    const html = `<div class="pagebar noprint"><div class="fgroup"><label class="label" for="repMonth">Report month</label><select id="repMonth" class="select">${opts.join('')}</select></div>` +
      `<div class="cact"><button type="button" class="btn" data-act="csv"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Download as CSV</button><button type="button" class="btn pri" data-act="print">Print report</button></div></div>` +
      `<article class="card report" aria-labelledby="rep-h"><header class="rhead"><div><span class="label">Adrial · management report · demo data</span><h2 id="rep-h">${esc(mName(mi))}${mtd ? ' <span class="muted">(month to date)</span>' : ''}</h2>` +
      `<p class="muted">${esc(rangeLabel(a, b))} · ${esc(scopeText())} · compared with ${pm ? esc(rangeLabel(pr[0], pr[1])) : '—'} and ${ly ? esc(rangeLabel(lr[0], lr[1])) : 'last year (no data)'}</p></div><p class="muted small">Generated ${esc(dLabel(A.TODAY))}</p></header>` +
      sub('Summary', `<ul class="comment">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`) +
      sub('Key figures', tableHtml(kT, 'rep-k')) +
      `<div class="rgrid">` + sub('Top locations', tableHtml(locT(top), 'rep-top')) + sub('Bottom locations', tableHtml(locT(bottom), 'rep-bot')) + `</div>` +
      `<div class="rgrid">` + sub('Category mix', tableHtml(catT, 'rep-cat')) + (sel.eshops.length ? sub('Marketing efficiency', tableHtml(mkT, 'rep-mk')) : sub('Marketing efficiency', '<p class="empty">No e-shop in the current filter.</p>')) + `</div>` +
      sub('Notable alerts', al.length ? `<ul class="alist">${al.map(x => `<li>${sevBadge(x.sev)} <b>${esc(x.label)}</b> · ${esc(x.title)} <span class="muted">(${esc(dLabel(x.dn0))}${x.dn0 !== x.dn ? ' – ' + esc(dLabel(x.dn)) : ''})</span></li>`).join('')}</ul>` : '<p class="muted">No unusual days or weeks detected.</p>') +
      `<p class="cfoot">Targets: last year +${esc(fmt.num1(targets.growth))}% unless edited. Figures are fictional demo data generated in the browser.</p></article>`;
    return { html, mounts: [() => { const s0 = $('repMonth'); if (s0) s0.addEventListener('change', () => setFilters({ m: s0.value })); }] };
  }

  // ── ERP & CRM (live) via the Adrial Apps bus ────────────────────────────────
  const bus = { ok: !!window.AdrialBus, loaded: false, erp: null, crm: null };
  function loadBus() {
    if (!window.AdrialBus) { bus.loaded = true; return Promise.resolve(); }
    return Promise.all([window.AdrialBus.read('erp.summary'), window.AdrialBus.read('crm.summary')])
      .then(r => { bus.erp = r[0] && r[0].data ? r[0] : null; bus.crm = r[1] && r[1].data ? r[1] : null; })
      .catch(() => {}).then(() => { bus.loaded = true; });
  }
  const numOr = v => (v != null && v !== '' && fin(+v) ? +v : NaN);
  const ago = iso => {
    const t = Date.parse(iso);
    if (!fin(t)) return 'unknown time';
    const s0 = (Date.now() - t) / 1000;
    const rel = s0 < 90 ? 'just now' : s0 < 5400 ? Math.round(s0 / 60) + ' min ago' : s0 < 129600 ? Math.round(s0 / 3600) + ' h ago' : Math.round(s0 / 86400) + ' days ago';
    return rel + ' (' + new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ')';
  };
  const asOfTxt = v => { if (v == null || v === '') return '—'; const t = Date.parse(v); return /T\d/.test(String(v)) && fin(t) ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : String(v); };
  const locName = k => String(k); // ERP keys locations by display name; shown as-is
  function liveEmpty(app, url, what) {
    return `<section class="card"><header class="ch"><div class="chl"><span class="label">${esc(app)} demo app</span><h2>No ${esc(app)} data yet</h2></div></header><div class="empty"><p>${esc(what)}</p><a class="btn" href="${url}">Open ${esc(app)} once</a></div></section>`;
  }
  function pageLive() {
    const parts = [], mounts = [];
    parts.push(`<div class="pagebar"><p>Live data published by the <b>ERP</b> and <b>CRM</b> demo apps in this browser (shared IndexedDB “adrial-bus”); it updates as soon as either app changes. It is separate from the generated analytics data on the other pages, so the totals do not reconcile with them, and the global filters do not apply here.</p></div>`);
    if (!bus.ok) return { html: parts.join('') + emptyCard('Bus unavailable', 'The shared Adrial Apps bus could not be loaded, so ERP and CRM data cannot be shown.'), mounts };
    if (!bus.loaded) return { html: parts.join('') + '<p class="empty">Loading ERP and CRM data…</p>', mounts };

    // ERP
    if (!bus.erp) parts.push(liveEmpty('ERP', '/erp/', 'The ERP demo publishes its summary (revenue, receivables, stock, open orders) when it opens.'));
    else {
      const d = bus.erp.data || {};
      const months = (Array.isArray(d.months) ? d.months : []).filter(m => m && /^\d{4}-\d{2}/.test(String(m.month))).slice().sort((p, q) => String(p.month).localeCompare(String(q.month)));
      const mrev = months.map(m => numOr(m.revenue)), mcogs = months.map(m => numOr(m.cogs));
      const last = months.length ? months[months.length - 1] : null;
      const rc = d.receivables || {}, buckets = [['Not due', 'notDue'], ['0–30 days', 'd0_30'], ['31–60 days', 'd31_60'], ['61–90 days', 'd61_90'], ['90+ days', 'd90p']].map(([l, k]) => ({ l, v: numOr(rc[k]) }));
      const recTot = buckets.reduce((a, x) => a + (fin(x.v) ? x.v : 0), 0), overdue = buckets.slice(1).reduce((a, x) => a + (fin(x.v) ? x.v : 0), 0);
      const low = Array.isArray(d.lowStock) ? d.lowStock : null, lowN = low ? low.length : numOr(d.lowStock);
      const totRev = mrev.reduce((a, v) => a + (fin(v) ? v : 0), 0), totCogs = mcogs.reduce((a, v) => a + (fin(v) ? v : 0), 0);
      const tile = (l, v, sub2) => `<article class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="d"><span class="muted">${esc(sub2 || '')}</span></div></article>`;
      parts.push(`<h2 class="sect">ERP <span class="muted">· from the ERP demo · as of ${esc(asOfTxt(d.asOf))} · updated ${esc(ago(bus.erp.updatedAt))}</span> <a class="tlink" href="/erp/">Open ERP →</a></h2>`);
      parts.push(`<section class="kpis" aria-label="ERP figures">` +
        tile(last ? 'Revenue ' + last.month + (String(last.month).slice(0, 7) === A.iso(A.TODAY).slice(0, 7) ? ' (to date)' : '') : 'Revenue', fmt.eurK(last ? numOr(last.revenue) : NaN), last ? 'gross margin ' + fmt.pct(div(numOr(last.revenue) - numOr(last.cogs), numOr(last.revenue))) : '') +
        tile('Revenue, all months', fmt.eurK(totRev), months.length + ' months · GM ' + fmt.pct(div(totRev - totCogs, totRev))) +
        tile('Receivables', fmt.eurK(recTot), fmt.eurK(overdue) + ' overdue') +
        tile('Stock value', fmt.eurK(numOr(d.stockValue)), 'at cost') +
        tile('Low-stock items', fmt.int(lowN), 'at or below reorder point') +
        tile('Open sales orders', fmt.int(numOr(d.openSalesOrders)), '') +
        tile('Open purchase orders', fmt.int(numOr(d.openPurchaseOrders)), '') + '</section>');
      if (months.length) {
        const labels = months.map(m => { const p = String(m.month); return MON[+p.slice(5, 7) - 1] + ' ' + p.slice(2, 4); });
        const mT = { caption: 'ERP revenue by month', cols: [{ h: 'Month' }, { h: 'Revenue', t: 'eur' }, { h: 'COGS', t: 'eur' }, { h: 'Gross margin', t: 'eur' }, { h: 'Margin %', t: 'pct' }, { h: 'Orders', t: 'int' }, { h: 'Invoices', t: 'int' }, { h: 'Paid', t: 'eur' }],
          rows: months.map((m, i) => ({ v: [m.month, mrev[i], mcogs[i], mrev[i] - mcogs[i], div(mrev[i] - mcogs[i], mrev[i]), numOr(m.orders), numOr(m.invoices), numOr(m.paid)] })), foot: ['Total', totRev, totCogs, totRev - totCogs, div(totRev - totCogs, totRev), NaN, NaN, NaN] };
        parts.push(card({ id: 'lv-erp-m', title: 'Revenue, COGS and margin by month', sub: 'ERP invoices · revenue net of credit notes, COGS net of returns · margin % in the tooltip and table', body: legend([{ label: 'Revenue', color: 'var(--c1)' }, { label: 'COGS', color: 'var(--c2)' }]) + chartDiv('lv-erp-m-c', 240), table: mT }));
        mounts.push(() => mount('lv-erp-m-c', w => lineChart({ w, h: 240, labels, fmtY: fmt.eurK, aria: 'ERP revenue and cost of goods by month',
          series: [{ name: 'COGS', vals: mcogs, color: 'var(--c2)' }, { name: 'Revenue', vals: mrev, color: 'var(--c1)', area: true }],
          tips: i => `<b>${esc(months[i].month)}</b><br>Revenue ${fmt.eur(mrev[i])}<br>COGS ${fmt.eur(mcogs[i])}<br>Margin ${fmt.eur(mrev[i] - mcogs[i])} · ${fmt.pct(div(mrev[i] - mcogs[i], mrev[i]))}` })));
        const agg = k => { const o = {}; months.forEach(m => { const x = m[k]; if (x && typeof x === 'object') Object.keys(x).forEach(q => { const v = numOr(x[q]); if (fin(v)) o[q] = (o[q] || 0) + v; }); }); return Object.keys(o).map(q => ({ k: q, v: o[q] })).sort((p, q) => q.v - p.v); };
        const byLoc = agg('byLocation'), byCat = agg('byCategory');
        const hb = (id, title, list, nameOf) => {
          const t = { caption: title, cols: [{ h: 'Name' }, { h: 'Revenue', t: 'eur' }, { h: 'Share', t: 'pct' }], rows: list.map(x => ({ v: [nameOf(x.k), x.v, div(x.v, totRev)] })) };
          mounts.push(() => mount(id + '-c', w => hbarChart({ w, aria: title, fmt: fmt.eurK, rows: list.map(x => ({ label: nameOf(x.k), value: x.v, color: 'var(--accent)', tip: `<b>${esc(nameOf(x.k))}</b><br>${fmt.eur(x.v)} · ${fmt.pct(div(x.v, totRev))}` })) })));
          return list.length ? card({ id, title, sub: 'All months in the snapshot', body: chartDiv(id + '-c'), table: t }) : emptyCard(title, 'Not included in the ERP snapshot.');
        };
        parts.push(`<div class="grid g2">${hb('lv-erp-l', 'Revenue by location', byLoc, locName)}${hb('lv-erp-c', 'Revenue by category', byCat, k => String(k))}</div>`);
      } else parts.push(emptyCard('Revenue by month', 'The ERP snapshot has no monthly figures yet.'));
      const agT = { caption: 'Receivables ageing', cols: [{ h: 'Bucket' }, { h: 'Amount', t: 'eur' }, { h: 'Share', t: 'pct' }], rows: buckets.map(x => ({ v: [x.l, x.v, div(x.v, recTot)] })), foot: ['Total', recTot, recTot ? 1 : NaN] };
      const lowList = low ? low.slice(0, 10).map(x => (x && typeof x === 'object') ? (x.name || x.sku || '') : String(x)) : [];
      parts.push(`<div class="grid g2">${card({ id: 'lv-erp-a', title: 'Receivables ageing', sub: 'Open invoices by days overdue', body: chartDiv('lv-erp-a-c'), table: agT })}` +
        `<section class="card"><header class="ch"><div class="chl"><h2>Stock &amp; open orders</h2><p>From the ERP snapshot</p></div></header><div class="cb"><div class="facts">` +
        `<div><span>Stock value</span><b>${esc(fmt.eur(numOr(d.stockValue)))}</b></div><div><span>Low-stock items</span><b>${esc(fmt.int(lowN))}</b></div><div><span>Open sales orders</span><b>${esc(fmt.int(numOr(d.openSalesOrders)))}</b></div><div><span>Open purchase orders</span><b>${esc(fmt.int(numOr(d.openPurchaseOrders)))}</b></div></div>` +
        (lowList.length ? `<p class="small muted" style="margin-top:12px">Low stock: ${lowList.map(esc).join(', ')}${low.length > 10 ? '…' : ''}</p>` : '') + `</div></section></div>`);
      mounts.push(() => mount('lv-erp-a-c', w => hbarChart({ w, aria: 'Receivables ageing', fmt: fmt.eurK, rows: buckets.map((x, i) => ({ label: x.l, value: x.v, color: i === 0 ? 'var(--accent)' : 'var(--bad-dot)', tip: `<b>${esc(x.l)}</b><br>${fmt.eur(x.v)} · ${fmt.pct(div(x.v, recTot))}` })) })));
    }

    // CRM
    if (!bus.crm) parts.push(liveEmpty('CRM', '/crm/', 'The CRM demo publishes its pipeline summary (stages, won deals, rep targets) when it opens.'));
    else {
      const c = bus.crm.data || {};
      const won = (Array.isArray(c.wonByMonth) ? c.wonByMonth : []).filter(x => x && x.month).slice().sort((p, q) => String(p.month).localeCompare(String(q.month)));
      const stages = (Array.isArray(c.byStage) ? c.byStage : []).filter(x => x && x.stage != null);
      const owners = (Array.isArray(c.byOwner) ? c.byOwner : []).filter(x => x && x.owner != null);
      let wr = numOr(c.winRate90d);
      if (fin(wr) && wr > 1) wr /= 100;
      const wonTot = won.reduce((a, x) => a + (fin(numOr(x.value)) ? numOr(x.value) : 0), 0), lastWon = won.length ? won[won.length - 1] : null;
      const tile = (l, v, sub2) => `<article class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="d"><span class="muted">${esc(sub2 || '')}</span></div></article>`;
      parts.push(`<h2 class="sect">CRM <span class="muted">· from the CRM demo · as of ${esc(asOfTxt(c.asOf))} · updated ${esc(ago(bus.crm.updatedAt))}</span> <a class="tlink" href="/crm/">Open CRM →</a></h2>`);
      parts.push(`<section class="kpis" aria-label="CRM figures">` + tile('Open pipeline', fmt.eurK(numOr(c.openPipeline)), stages.filter(x => !/won|lost/i.test(String(x.stage))).reduce((a, x) => a + (numOr(x.count) || 0), 0) + ' open deals') +
        tile('Weighted forecast', fmt.eurK(numOr(c.weightedForecastQuarter)), c.quarter ? String(c.quarter) : 'this quarter') + tile('Win rate', fmt.pct(wr), 'last 90 days') +
        tile(lastWon ? 'Won ' + lastWon.month : 'Won', fmt.eurK(lastWon ? numOr(lastWon.value) : NaN), lastWon ? fmt.int(numOr(lastWon.count)) + ' deals' : '') + tile('Won, all months', fmt.eurK(wonTot), won.length + ' months') + '</section>');
      const stT = { caption: 'Pipeline by stage', cols: [{ h: 'Stage' }, { h: 'Deals', t: 'int' }, { h: 'Value', t: 'eur' }], rows: stages.map(x => ({ v: [String(x.stage), numOr(x.count), numOr(x.value)] })) };
      const wT = { caption: 'Won by month', cols: [{ h: 'Month' }, { h: 'Deals won', t: 'int' }, { h: 'Value', t: 'eur' }], rows: won.map(x => ({ v: [String(x.month), numOr(x.count), numOr(x.value)] })), foot: ['Total', won.reduce((a, x) => a + (numOr(x.count) || 0), 0), wonTot] };
      parts.push(`<div class="grid g2">${stages.length ? card({ id: 'lv-crm-s', title: 'Pipeline by stage', sub: 'Value of deals in each stage', body: chartDiv('lv-crm-s-c'), table: stT }) : emptyCard('Pipeline by stage', 'No stages in the CRM snapshot.')}` +
        (won.length ? card({ id: 'lv-crm-w', title: 'Won by month', sub: 'Value of deals won', body: chartDiv('lv-crm-w-c', 220), table: wT }) : emptyCard('Won by month', 'No won deals in the CRM snapshot.')) + '</div>');
      mounts.push(() => mount('lv-crm-s-c', w => hbarChart({ w, aria: 'CRM pipeline by stage', fmt: fmt.eurK, rows: stages.map(x => ({ label: String(x.stage), sub: fmt.int(numOr(x.count)) + ' deals', value: numOr(x.value), color: 'var(--accent)', tip: `<b>${esc(x.stage)}</b><br>${fmt.int(numOr(x.count))} deals · ${fmt.eur(numOr(x.value))}` })) })));
      mounts.push(() => mount('lv-crm-w-c', w => stackChart({ w, h: 220, labels: won.map(x => { const p = String(x.month); return MON[+p.slice(5, 7) - 1] + ' ' + p.slice(2, 4); }), fmtY: fmt.eurK, aria: 'CRM value won by month', series: [{ name: 'Won', vals: won.map(x => numOr(x.value)), color: 'var(--accent)' }], tips: i => `<b>${esc(won[i].month)}</b><br>${fmt.eur(numOr(won[i].value))} · ${fmt.int(numOr(won[i].count))} deals` })));
      if (owners.length) {
        const oT = { sortable: true, caption: 'Won vs target by rep', cols: [{ h: 'Rep' }, { h: 'Won', t: 'eur' }, { h: 'Target', t: 'eur' }, { h: 'Attainment', t: 'pct' }, { h: 'Open pipeline', t: 'eur' }], rows: owners.map(o => ({ v: [String(o.owner), numOr(o.won), numOr(o.target), div(numOr(o.won), numOr(o.target)), numOr(o.open)] })) };
        parts.push(card({ id: 'lv-crm-o', title: 'Won vs target by rep', sub: 'Per sales rep' + (c.quarter ? ' · ' + esc(String(c.quarter)) : ''), body: legend([{ label: 'Won', color: 'var(--c1)' }, { label: 'Target', color: 'var(--c3)' }]) + chartDiv('lv-crm-o-c'), table: oT }));
        mounts.push(() => mount('lv-crm-o-c', w => groupBars({ w, aria: 'Won versus target per sales rep', fmt: fmt.eurK, series: [{ name: 'Won', color: 'var(--c1)' }, { name: 'Target', color: 'var(--c3)' }],
          rows: owners.map(o => ({ label: String(o.owner), vals: [numOr(o.won), numOr(o.target)], tip: `<b>${esc(o.owner)}</b><br>Won ${fmt.eur(numOr(o.won))}<br>Target ${fmt.eur(numOr(o.target))}<br>${fmt.pct0(div(numOr(o.won), numOr(o.target)))} attained` })) })));
      }
    }
    return { html: parts.join(''), mounts };
  }

  // ── Targets editor (drawer) ─────────────────────────────────────────────────
  function openTargets(trigger) {
    closeLayer();
    layerReturn = trigger || document.activeElement;
    const nowMi = mIdx(A.TODAY), first = 12, last = nowMi + 3;
    if (!(ui.tMonth >= first && ui.tMonth <= last)) ui.tMonth = nowMi;
    const draw = () => {
      const mi = ui.tMonth, k = mKey(mi), ro = targets.rev[k] || {}, go = targets.gm[k] || {};
      const rows = LOCS.map((L, li) => {
        const ly = LOCM[((mi - 12) * NL + li) * 2], dr = defRev(mi, li), dg = defGm(mi, li);
        return `<tr><th scope="row">${esc(L.name)}<small>${L.country} · ${L.type === 'store' ? 'Store' : 'E-shop'}</small></th><td class="r">${fmt.eur(ly)}</td>` +
          `<td class="r"><label class="sr" for="tr-${li}">${esc(L.name)} revenue target</label><input id="tr-${li}" class="input num" inputmode="decimal" data-li="${li}" data-k="rev" value="${fin(ro[L.id]) ? Math.round(ro[L.id]) : ''}" placeholder="${Math.round(dr)}"></td>` +
          `<td class="r"><label class="sr" for="tg-${li}">${esc(L.name)} margin target %</label><input id="tg-${li}" class="input num sm" inputmode="decimal" data-li="${li}" data-k="gm" value="${fin(go[L.id]) ? (go[L.id] * 100).toFixed(1) : ''}" placeholder="${fin(dg) ? (dg * 100).toFixed(1) : ''}"></td></tr>`;
      }).join('');
      const opts = [];
      for (let m0 = last; m0 >= first; m0--) opts.push(`<option value="${m0}"${m0 === mi ? ' selected' : ''}>${mName(m0)}${targets.rev[mKey(m0)] || targets.gm[mKey(m0)] ? ' · edited' : ''}</option>`);
      layer.innerHTML = `<div class="scrim" data-close></div><aside class="drawer wide" role="dialog" aria-modal="true" aria-labelledby="tg-dh">` +
        `<div class="dh"><div><span class="label">Budget · saved in this browser</span><h2 id="tg-dh">Edit targets</h2><p class="muted">Revenue and gross-margin targets per location and month, for all categories and channels.</p></div><button type="button" class="iconbtn" data-close aria-label="Close targets"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>` +
        `<div class="db"><form id="tgRule" class="tgrule"><div class="fgroup"><label class="label" for="tgGrowth">Default growth vs last year (%)</label><input id="tgGrowth" class="input" inputmode="decimal" value="${esc(targets.growth)}"></div>` +
        `<div class="fgroup"><label class="label" for="tgPP">Margin uplift (pp)</label><input id="tgPP" class="input" inputmode="decimal" value="${esc(targets.marginPP)}"></div><button type="submit" class="btn">Apply default rule</button></form>` +
        `<div class="fgroup" style="margin:16px 0 8px"><label class="label" for="tgMonth">Month</label><select id="tgMonth" class="select">${opts.join('')}</select></div>` +
        `<form id="tgForm"><div class="tablewrap"><table class="tgtable"><thead><tr><th scope="col">Location</th><th scope="col" class="r">Last year</th><th scope="col" class="r">Revenue target €</th><th scope="col" class="r">GM %</th></tr></thead><tbody>${rows}</tbody>` +
        `<tfoot><tr><th scope="row">Total</th><td class="r">${fmt.eur(LOCS.reduce((a, _, li) => a + LOCM[((mi - 12) * NL + li) * 2], 0))}</td><td class="r" id="tgTotal"></td><td></td></tr></tfoot></table></div>` +
        `<p class="small muted">Leave a field empty to use the default (shown in grey).</p><div class="tgbtns"><button type="submit" class="btn pri">Save ${esc(mName(mi))}</button><button type="button" class="btn" data-tg="month">Reset month</button><button type="button" class="btn ghost" data-tg="all">Reset all targets</button></div></form></div></aside>`;
      layerKind = 'targets';
      document.body.classList.add('locked');
      const total = () => { let s0 = 0; LOCS.forEach((_, li) => { const inp = $('tr-' + li); const v = inp.value.trim() === '' ? defRev(mi, li) : parseNum(inp.value); s0 += fin(v) ? v : 0; }); $('tgTotal').textContent = fmt.eur(s0); };
      total();
      layer.querySelector('#tgForm').addEventListener('input', total);
      layer.querySelector('#tgMonth').addEventListener('change', e => { ui.tMonth = +e.target.value; draw(); const s0 = $('tgMonth'); if (s0) s0.focus(); });
      layer.querySelector('#tgRule').addEventListener('submit', e => {
        e.preventDefault();
        const g = parseNum($('tgGrowth').value), p = parseNum($('tgPP').value);
        if (!fin(g) || g <= -90 || g >= 500 || !fin(p) || Math.abs(p) >= 50) { toast('Enter a growth between −90 and 500 % and an uplift below 50 pp.'); return; }
        targets.growth = g; targets.marginPP = p; saveTargets(); render(); draw(); refocusTg('#tgGrowth'); toast('Default rule saved: last year +' + fmt.num1(g) + '%.');
      });
      layer.querySelector('#tgForm').addEventListener('submit', e => {
        e.preventDefault();
        const rv = {}, gv = {};
        let bad = '';
        LOCS.forEach((L, li) => {
          const a = $('tr-' + li).value.trim(), b = $('tg-' + li).value.trim();
          if (a !== '') { const v = parseNum(a); if (!fin(v) || v < 0) bad = L.name; else rv[L.id] = v; }
          if (b !== '') { const v = parseNum(b); if (!fin(v) || v < 0 || v >= 100) bad = L.name; else gv[L.id] = v / 100; }
        });
        if (bad) { toast('Check the values for ' + bad + '.'); return; }
        if (Object.keys(rv).length) targets.rev[k] = rv; else delete targets.rev[k];
        if (Object.keys(gv).length) targets.gm[k] = gv; else delete targets.gm[k];
        saveTargets(); render(); draw(); refocusTg('#tgForm button[type=submit]'); toast('Targets for ' + mName(mi) + ' saved.');
      });
      layer.querySelector('.tgbtns').addEventListener('click', e => {
        const b = e.target.closest('[data-tg]');
        if (!b) return;
        if (b.getAttribute('data-tg') === 'month') { delete targets.rev[k]; delete targets.gm[k]; toast(mName(mi) + ' reset to the default rule.'); }
        else { targets = { growth: TDEF.growth, marginPP: TDEF.marginPP, rev: {}, gm: {} }; toast('All targets reset to last year +' + TDEF.growth + '%.'); }
        saveTargets(); render(); draw(); refocusTg('#tgForm button[type=submit]');
      });
    };
    draw();
    const f = $('tgGrowth'); if (f) f.focus();
  }
  const refocusTg = sel0 => { const el = layer.querySelector(sel0); if (el) el.focus(); };
  const parseNum = s => { const t = String(s).replace(/[€%\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.'); return t === '' ? NaN : +t; };

  // ── Store drawer ────────────────────────────────────────────────────────────
  const layer = $('layer');
  let layerReturn = null, layerKind = '';
  function closeLayer() {
    if (!layer.innerHTML) return;
    const kind = layerKind;
    if (ro) layer.querySelectorAll('.chart').forEach(h => ro.unobserve(h));
    layer.innerHTML = ''; layerKind = '';
    document.body.classList.remove('locked');
    hideTip();
    if (kind === 'drawer' && drawerLoc) { drawerLoc = ''; history.replaceState(null, '', hashFor(page)); }
    if (layerReturn && layerReturn.isConnected) layerReturn.focus();
    layerReturn = null;
  }
  function openStore(id, trigger) {
    const L = LOCS.find(x => x.id === id);
    if (!L) return;
    const li = LOCS.indexOf(L);
    if (page !== 'stores') { location.hash = hashFor('stores', id); return; }
    layerReturn = trigger || document.activeElement;
    drawerLoc = id;
    history.replaceState(null, '', hashFor(page, id));
    const R = getRange(), sel = selection({ loc: id });
    const cur = compute(R.ai, R.bi, sel), cmp = R.cmpOk ? compute(R.cai, R.cbi, sel) : null;
    const T = cur.tot, P = cmp ? cmp.tot : null, isS = L.type === 'store';
    const facts = [
      ['Revenue', fmt.eur(T.rev), P ? deltaHtml(T.rev, P.rev) : ''],
      ['Orders', fmt.int(T.orders), P ? deltaHtml(T.orders, P.orders) : ''],
      ['Avg order value', fmt.eur2(div(T.rev, T.orders)), P ? deltaHtml(div(T.rev, T.orders), div(P.rev, P.orders)) : ''],
      ['Gross margin', fmt.pct(div(T.rev - T.cogs, T.rev)), P ? deltaHtml(div(T.rev - T.cogs, T.rev), div(P.rev - P.cogs, P.rev), 'pp') : ''],
      ['Return rate', fmt.pct(div(T.retRev, T.rev)), P ? deltaHtml(div(T.retRev, T.rev), div(P.retRev, P.rev), 'pp', true) : '']
    ];
    if (isS) {
      facts.push(['Foot traffic', fmt.int(sel.stores.length ? T.traffic : NaN), P && sel.stores.length ? deltaHtml(T.traffic, P.traffic) : '']);
      facts.push(['Conversion', fmt.pct(sel.stores.length ? div(T.orders, T.traffic) : NaN), '']);
      facts.push(['Eye exams', fmt.int(sel.stores.length ? T.exams : NaN), sel.stores.length ? `<span class="muted">${fmt.int(T.bookings)} booked · ${fmt.pct(div(T.exams, T.bookings))} show rate</span>` : '']);
    } else {
      facts.push(['Sessions', fmt.int(sel.eshops.length ? T.sessions : NaN), P && sel.eshops.length ? deltaHtml(T.sessions, P.sessions) : '']);
      facts.push(['Conversion', fmt.pct2(div(T.eOrders, T.sessions)), '']);
      facts.push(['ROAS', fmt.x(div(T.eRev, T.spend)), `<span class="muted">${fmt.eur(T.spend)} spend</span>`]);
    }
    const gc = group(cur.combo, c => c.cat, 6);
    const cats = CATS.map((c, i) => ({ i, name: c.name, v: gc[i][0], o: gc[i][2] })).filter(x => x.v > 0);
    layer.innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-h">` +
      `<div class="dh"><div><span class="label">${L.country === 'SI' ? 'Slovenia' : 'Croatia'} · ${isS ? 'Store' : 'E-shop'}</span><h2 id="dr-h">${esc(L.name)}</h2><p class="muted">${esc(rangeLabel(R.a, R.b))}${cmp ? ' · ' + cmpShort() : ''}</p></div><button type="button" class="iconbtn" data-close aria-label="Close details"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>` +
      `<div class="db"><div class="facts">${facts.map(f => `<div><span>${esc(f[0])}</span><b>${f[1]}</b>${f[2] ? `<em>${f[2]}</em>` : ''}</div>`).join('')}</div>` +
      `<h3>Revenue trend</h3><div class="chart" id="dr-trend"></div><h3>Category mix</h3><div class="chart" id="dr-mix"></div></div></aside>`;
    layerKind = 'drawer';
    document.body.classList.add('locked');
    const g = gran(R.n), B = makeBuckets(R.ai, R.n, g), cs = sumB(cur.D.rev, B), psr = cmp ? sumBc(cmp.D.rev, B) : null;
    mount('dr-trend', w => lineChart({
      w, h: 220, labels: B.map(b => b.short), fmtY: fmt.eurK, aria: `${L.name} revenue trend`,
      series: [psr ? { vals: psr, color: 'var(--ink3)', dash: true, width: 1.6 } : null, { vals: cs, color: 'var(--accent)', area: true }].filter(Boolean),
      tips: j => `<b>${esc(B[j].full)}</b><br>Revenue: ${fmt.eur(cs[j])}${psr ? `<br><span class="tmuted">Comparison: ${fmt.eur(psr[j])}</span> ${deltaHtml(cs[j], psr[j])}` : ''}`
    }));
    mount('dr-mix', w => hbarChart({
      w, aria: `${L.name} revenue by category`, fmt: fmt.eurK,
      rows: cats.map(x => ({ label: x.name, sub: fmt.pct(div(x.v, T.rev)) + ' · ' + fmt.int(x.o) + ' orders', value: x.v, color: color(x.i), tip: `<b>${esc(x.name)}</b><br>${fmt.eur(x.v)} · ${fmt.pct(div(x.v, T.rev))}` }))
    }));
    layer.querySelector('.drawer .iconbtn').focus();
  }

  // ── Popovers: locations & saved views ───────────────────────────────────────
  function openPop(btn, html, label) {
    closeLayer();
    layerReturn = btn;
    layer.innerHTML = `<div class="scrim clear" data-close></div><div class="pop" role="dialog" aria-label="${esc(label)}">${html}</div>`;
    layerKind = 'pop';
    placePop();
    const first = layer.querySelector('.pop input, .pop button');
    if (first) first.focus();
  }
  function placePop() {
    const pop = layer.querySelector('.pop');
    if (!pop || !layerReturn) return;
    const r = layerReturn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, pw = Math.min(320, vw - 16);
    pop.style.left = Math.max(8, Math.min(r.left, vw - pw - 8)) + 'px';
    pop.style.top = Math.max(8, Math.round(r.bottom + 6)) + 'px';
  }
  function locPopHtml() {
    const set = st.l ? new Set(st.l.split(',')) : null;
    const grp = (k, name) => {
      if (st.co !== 'all' && st.co !== k) return '';
      return `<fieldset><legend class="label">${name}</legend>${LOCS.filter(L => L.country === k).map(L => `<label class="chk"><input type="checkbox" value="${L.id}" ${!set || set.has(L.id) ? 'checked' : ''}> ${esc(L.name)}<small>${L.type === 'store' ? 'Store' : 'E-shop'}</small></label>`).join('')}</fieldset>`;
    };
    return `<div class="poph"><button type="button" class="chip" data-pick="all">All</button><button type="button" class="chip" data-pick="store">Stores only</button><button type="button" class="chip" data-pick="eshop">E-shops only</button></div>` +
      grp('SI', 'Slovenia') + grp('HR', 'Croatia') + `<div class="popf"><button type="button" class="btn sm pri" data-close>Done</button></div>`;
  }
  function locPopBind() {
    const pop = layer.querySelector('.pop');
    pop.addEventListener('change', () => {
      const ids = [...pop.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value);
      if (!ids.length) { toast('Select at least one location.'); pop.querySelector('input[type=checkbox]').checked = true; return; }
      const all = ids.length === pop.querySelectorAll('input[type=checkbox]').length;
      setFilters({ l: all ? '' : ids.join(',') });
    });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const t = b.getAttribute('data-pick');
      const ids = t === 'all' ? [] : LOCS.filter(L => L.type === t).map(L => L.id);
      setFilters({ l: ids.join(',') });
      pop.querySelectorAll('input[type=checkbox]').forEach(x => { x.checked = t === 'all' || LOCS.find(L => L.id === x.value).type === t; });
    });
  }
  function views() { const v = lsGet('views', []); return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string' && typeof x.hash === 'string') : []; }
  function viewsPopHtml() {
    const vs = views();
    return `<form class="vform" data-vsave><label class="label" for="vname">Save current view</label><div class="vrow"><input id="vname" class="input" maxlength="40" placeholder="e.g. Croatia stores YTD" required><button type="submit" class="btn sm pri">Save</button></div></form>` +
      (vs.length ? `<ul class="vlist">${vs.map((v, i) => `<li><button type="button" class="vlink" data-vload="${i}">${esc(v.name)}<small>${esc(v.desc || '')}</small></button><button type="button" class="iconbtn sm" data-vdel="${i}" aria-label="Delete view ${esc(v.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`).join('')}</ul>`
        : '<p class="muted small">No saved views yet. Views are stored in this browser only.</p>');
  }
  function viewsPopBind() {
    const pop = layer.querySelector('.pop');
    pop.addEventListener('submit', e => {
      e.preventDefault();
      const name = $('vname').value.trim();
      if (!name) return;
      const vs = views().filter(v => v.name !== name);
      const R = getRange();
      vs.unshift({ name, hash: hashFor(page), desc: (PAGES.find(p => p[0] === page) || [0, ''])[1] + ' · ' + R.label, saved: Date.now() });
      lsSet('views', vs.slice(0, 30));
      pop.innerHTML = viewsPopHtml();
      toast('View "' + name + '" saved.');
      const first = pop.querySelector('input');
      if (first) first.focus();
    });
    pop.addEventListener('click', e => {
      const l = e.target.closest('[data-vload]'), d = e.target.closest('[data-vdel]');
      if (l) { const v = views()[+l.getAttribute('data-vload')]; if (v) { layerReturn = $('fViews'); closeLayer(); location.hash = v.hash; toast('Loaded "' + v.name + '".'); } }
      if (d) {
        const vs = views(), v = vs[+d.getAttribute('data-vdel')];
        vs.splice(+d.getAttribute('data-vdel'), 1);
        lsSet('views', vs);
        pop.innerHTML = viewsPopHtml();
        if (v) toast('View "' + v.name + '" deleted.');
        const f = pop.querySelector('input'); if (f) f.focus();
      }
    });
  }

  // ── Toast ───────────────────────────────────────────────────────────────────
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

  // ── CSV export ──────────────────────────────────────────────────────────────
  function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    const R = getRange();
    const RP = page === 'report' && ui.reportPeriod ? ui.reportPeriod : null;
    const period = RP ? [RP.a, RP.b] : [R.a, R.b];
    const lines = [['Adrial Analytics (demo data)'], ['Page', (PAGES.find(p => p[0] === page) || [0, page])[1]], ['Period', A.iso(period[0]), A.iso(period[1])],
      RP ? ['Comparison', 'previous month', RP.pr ? A.iso(RP.pr[0]) : '', RP.pr ? A.iso(RP.pr[1]) : '', 'last year', RP.lr ? A.iso(RP.lr[0]) : '', RP.lr ? A.iso(RP.lr[1]) : '']
        : page === 'live' ? ['Source', 'ERP and CRM demo apps (adrial-bus snapshots)'] : ['Comparison', R.cmpOk ? cmpName() : 'none', R.cmpOk ? A.iso(R.ca) : '', R.cmpOk ? A.iso(R.cb) : ''],
      ['Filters', page === 'live' ? 'not applied' : scopeText()], ['Note', 'Targets and forecasts are plans/estimates, not actuals'], []];
    ui.exports.forEach(ex => {
      lines.push([ex.title]);
      lines.push(ex.t.cols.map(c => c.h + ((TYPES[c.t || 'txt'] || {}).unit || '')));
      const conv = row => ex.t.cols.map((c, j) => (TYPES[c.t || 'txt'] || TYPES.txt).csv(row[j]));
      ex.t.rows.forEach(r => lines.push(conv(r.v)));
      if (ex.t.foot) lines.push(conv(ex.t.foot));
      lines.push([]);
    });
    const csv = '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `adrial-analytics-${page}-${A.iso(period[0])}_${A.iso(period[1])}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV exported (' + ui.exports.length + ' tables).');
  }

  // ── Filters bar ─────────────────────────────────────────────────────────────
  function scopeText() {
    const set = st.l ? st.l.split(',') : null;
    const locs = LOCS.filter(L => (st.co === 'all' || L.country === st.co) && (!set || set.includes(L.id)));
    const where = !set ? (st.co === 'all' ? 'All locations' : (st.co === 'SI' ? 'Slovenia' : 'Croatia') + ' · all locations') : (locs.length <= 3 ? locs.map(L => L.name).join(', ') : locs.length + ' locations');
    const ch = st.ch === 'all' ? 'All channels' : CHANNELS.find(c => c.id === st.ch).name;
    const cat = st.cat === 'all' ? 'All categories' : CATS.find(c => c.id === st.cat).name;
    return [where, ch, cat].join(' · ');
  }
  function initFilters() {
    $('fRange').innerHTML = PRESETS.map(p => `<option value="${p[0]}">${p[1]}</option>`).join('');
    $('fCh').innerHTML = '<option value="all">All channels</option>' + CHANNELS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    $('fCat').innerHTML = '<option value="all">All categories</option>' + CATS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    ['fFrom', 'fTo'].forEach(id => { $(id).min = A.iso(A.START); $(id).max = A.iso(A.TODAY); });
    $('fRange').addEventListener('change', e => {
      const v = e.target.value;
      if (v === 'custom') { const R = getRange(); setFilters({ r: 'custom', f: A.iso(R.a), t: A.iso(R.b) }); }
      else setFilters({ r: v });
    });
    const dateChange = () => { const f = $('fFrom').value, t = $('fTo').value; if (f && t) setFilters({ r: 'custom', f, t }); };
    $('fFrom').addEventListener('change', dateChange);
    $('fTo').addEventListener('change', dateChange);
    $('fCmp').addEventListener('change', e => setFilters({ c: e.target.value }));
    $('fCh').addEventListener('change', e => setFilters({ ch: e.target.value }));
    $('fCat').addEventListener('change', e => setFilters({ cat: e.target.value }));
    $('fCountry').addEventListener('click', e => { const b = e.target.closest('[data-co]'); if (b) setFilters({ co: b.getAttribute('data-co') }); });
    $('fLocs').addEventListener('click', e => { openPop(e.currentTarget, locPopHtml(), 'Stores and e-shops'); locPopBind(); });
    $('fViews').addEventListener('click', e => { openPop(e.currentTarget, viewsPopHtml(), 'Saved views'); viewsPopBind(); });
    $('fReset').addEventListener('click', () => { setFilters(Object.assign({}, DEF)); toast('Filters reset.'); });
    $('fExport').addEventListener('click', exportCsv);
    $('fPrint').addEventListener('click', () => window.print());
  }
  function syncFilters(R, alertN) {
    $('fRange').value = st.r;
    $('fCmp').value = st.c;
    $('fCh').value = st.ch;
    $('fCat').value = st.cat;
    $('customWrap').hidden = st.r !== 'custom';
    $('fFrom').value = A.iso(R.a); $('fTo').value = A.iso(R.b);
    $('fCountry').querySelectorAll('[data-co]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-co') === st.co)));
    const set = st.l ? st.l.split(',') : null;
    const locs = LOCS.filter(L => (st.co === 'all' || L.country === st.co) && (!set || set.includes(L.id)));
    $('fLocs').querySelector('span').textContent = !set ? 'All locations' : locs.length === 1 ? locs[0].name : locs.length + ' locations';
    $('nav').innerHTML = PAGES.map(p => `<a href="${hashFor(p[0])}"${p[0] === page ? ' aria-current="page"' : ''}>${p[1]}${p[0] === 'alerts' && alertN ? ` <span class="nbadge" aria-label="${alertN} high or medium alerts">${alertN}</span>` : ''}</a>`).join('');
    document.body.setAttribute('data-page', page);
    const cmpTxt = R.cmpOk ? `compared with ${cmpName()} <b>${esc(rangeLabel(R.ca, R.cb))}</b>` : `<span class="warn">no comparison: ${esc(cmpName())} starts before the data (${esc(dLabel(A.START))})</span>`;
    $('scope').innerHTML = page === 'live' ? '<b>ERP &amp; CRM (live)</b> · data from the demo apps in this browser · the filters above do not apply to this page'
      : page === 'report' ? `<b>Monthly report</b> · uses its own month selector below; the location, channel and category filters apply<br><span class="muted">${esc(scopeText())}</span>`
        : `<b>${esc(R.label)}</b> · ${esc(rangeLabel(R.a, R.b))} (${R.n} day${R.n === 1 ? '' : 's'}) · ${cmpTxt}<br><span class="muted">${esc(scopeText())}</span>`;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  let mountedHosts = [];
  function render() {
    const t0 = performance.now();
    hideTip();
    if (ro) mountedHosts.forEach(h => ro.unobserve(h));
    const R = getRange(), sel = selection();
    const alertN = sel.combos.length && page !== 'live' ? detectAlerts(R.bi, 28, sel).filter(a => a.sev === 'high' || a.sev === 'medium').length : 0;
    syncFilters(R, alertN);
    ui.exports = [];
    document.title = (PAGES.find(p => p[0] === page) || [0, ''])[1] + ' · Analytics — Adrial Apps';
    let out;
    if (page === 'live') out = pageLive();
    else if (!sel.combos.length && page !== 'ecommerce') out = { html: emptyCard('No data', 'Nothing matches the current filters. Try another channel, category or location.'), mounts: [] };
    else if (page === 'customers') out = pageCustomers(R);
    else if (page === 'alerts') out = pageAlerts(R, sel);
    else if (page === 'report') out = pageReport(sel);
    else {
      const cur = compute(R.ai, R.bi, sel), cmp = R.cmpOk ? compute(R.cai, R.cbi, sel) : null;
      out = page === 'stores' ? pageStores(R, sel, cur, cmp) : page === 'ecommerce' ? pageEcom(R, sel, cur, cmp) : page === 'products' ? pageProducts(R, sel, cur, cmp) : page === 'targets' ? pageTargets(R, sel, cur, cmp) : pageOverview(R, sel, cur, cmp);
    }
    const main = $('main');
    main.innerHTML = out.html;
    main.setAttribute('data-page', page);
    out.mounts.forEach(f => f());
    mountedHosts = [...main.querySelectorAll('.chart')];
    if (ui.refocus) { const el = main.querySelector(ui.refocus); if (el) el.focus(); ui.refocus = null; }
    if (layerKind === 'drawer') closeLayerSilently();
    if (page === 'stores' && drawerLoc) openStore(drawerLoc, null);
    else if (drawerLoc) { drawerLoc = ''; history.replaceState(null, '', hashFor(page)); }
    ui.lastRender = performance.now() - t0;
    $('foot').innerHTML = `<span class="pill demo"><i></i>Demo data</span> Fictional figures generated in your browser · data ${esc(dLabel(A.START))} – ${esc(dLabel(A.TODAY))} · generated in ${Math.round(A.genMs)} ms · page rendered in ${Math.round(ui.lastRender)} ms`;
  }

  // ── Global events ───────────────────────────────────────────────────────────
  $('main').addEventListener('click', e => {
    const t = e.target.closest('[data-ttoggle]');
    if (t) {
      const id = t.getAttribute('data-ttoggle'), on = !ui.tables[id];
      ui.tables[id] = on;
      const c = $(id);
      if (on) c.setAttribute('data-tab', '1'); else c.removeAttribute('data-tab');
      t.setAttribute('aria-pressed', String(on)); t.textContent = on ? 'View chart' : 'View as table';
      if (!on) c.querySelectorAll('.chart').forEach(h => drawChart(h));
      return;
    }
    const s = e.target.closest('[data-sort]');
    if (s) {
      const [tid, cs] = s.getAttribute('data-sort').split(':'), c = +cs, cur = ui.sort[tid];
      ui.sort[tid] = { c, d: cur && cur.c === c ? -cur.d : (+s.getAttribute('data-d') || 1) };
      lsSet('sort', ui.sort);
      ui.refocus = `[data-sort="${tid}:${c}"]`;
      render();
      return;
    }
    const ovl = e.target.closest('[data-ovl]');
    if (ovl) {
      const k = ovl.getAttribute('data-ovl'), cur0 = st.ov === 'none' ? '' : st.ov;
      const nx = (cur0.includes(k) ? cur0.replace(k, '') : cur0 + k).split('').sort((x, y) => (x === 't' ? -1 : 1) - (y === 't' ? -1 : 1)).join('');
      ui.refocus = `[data-ovl="${k}"]`;
      setFilters({ ov: nx || 'none' });
      return;
    }
    const aw = e.target.closest('[data-aw]'), ak = e.target.closest('[data-ak]');
    if (aw) { ui.refocus = `[data-aw="${aw.getAttribute('data-aw')}"]`; setFilters({ aw: aw.getAttribute('data-aw') }); return; }
    if (ak) { ui.refocus = `[data-ak="${ak.getAttribute('data-ak')}"]`; setFilters({ ak: ak.getAttribute('data-ak') }); return; }
    if (e.target.closest('[data-exp]')) { ui.showExpected = !ui.showExpected; ui.refocus = '[data-exp]'; render(); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const k = act.getAttribute('data-act');
      if (k === 'edit-targets') openTargets(act);
      else if (k === 'print') window.print();
      else if (k === 'csv') exportCsv();
      return;
    }
    const g = e.target.closest('[data-gran]');
    if (g) { ui.refocus = `[data-gran="${g.getAttribute('data-gran')}"]`; setFilters({ g: g.getAttribute('data-gran') }); return; }
    const sto = e.target.closest('[data-store]');
    if (sto) openStore(sto.getAttribute('data-store'), sto.tagName === 'BUTTON' ? sto : sto.querySelector('button'));
  });
  layer.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeLayer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && layer.innerHTML) { e.preventDefault(); closeLayer(); return; }
    if (e.key === 'Tab' && (layerKind === 'drawer' || layerKind === 'targets')) {
      const f = [...layer.querySelectorAll('button, [href], input, select, [tabindex="0"]')].filter(x => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  window.addEventListener('hashchange', () => { const prev = page; closeLayerSilently(); readHash(false); render(); if (prev !== page) window.scrollTo(0, 0); });
  function closeLayerSilently() { if (layer.innerHTML) { layer.innerHTML = ''; layerKind = ''; document.body.classList.remove('locked'); } }
  window.addEventListener('adrial-theme', () => redrawAll());
  window.addEventListener('scroll', () => {
    const a = document.activeElement;
    if (a && a._refresh && a.closest && a.closest('.chart')) a._refresh(); else hideTip();
    if (layerKind === 'pop') placePop();
  }, { passive: true });
  window.addEventListener('beforeprint', () => { hideTip(); });

  initFilters();
  readHash(true);
  render();
  loadBus().then(() => { if (page === 'live') render(); });
  if (window.AdrialBus && window.AdrialBus.on) {
    window.AdrialBus.on(evt => {
      if (evt && evt.kind === 'snapshot' && (/^(erp|crm)\.summary$/.test(evt.key || '') || /\.reset$/.test(evt.key || ''))) loadBus().then(() => { if (page === 'live') render(); });
    });
  }
})();
