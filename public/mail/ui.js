/* AM.UI: page header, chips, condition editor, profile picker, sandboxed preview frame, pager. Defines AM.route and the event registry. */
(function () {
  const AM = window.AM = window.AM || {}, U = AM.U, E = AM.E, esc = U.esc;
  const UI = AM.UI = {};
  AM.routes = [];
  AM.route = (re, fn, nav) => { AM.routes.push({ re, fn, nav }); };
  /* delegated events: data-act (click), data-in (input), data-ch (change), data-sub (submit) */
  const H = { click: {}, input: {}, change: {}, submit: {} };
  AM.act = (n, f) => { H.click[n] = f; }; AM.onInput = (n, f) => { H.input[n] = f; }; AM.onChange = (n, f) => { H.change[n] = f; }; AM.onSubmit = (n, f) => { H.submit[n] = f; };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const f = H.click[el.dataset.act]; if (!f) return;
    if (el.tagName === 'A' && (el.getAttribute('href') || '#') === '#') e.preventDefault();
    f(el, e);
  });
  document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (el && H.input[el.dataset.in]) H.input[el.dataset.in](el, e); });
  document.addEventListener('change', e => { const el = e.target.closest('[data-ch]'); if (el && H.change[el.dataset.ch]) H.change[el.dataset.ch](el, e); });
  document.addEventListener('submit', e => { const el = e.target.closest('[data-sub]'); if (el && H.submit[el.dataset.sub]) { e.preventDefault(); H.submit[el.dataset.sub](el, e); } });
  AM.act('chart-tbl', el => AM.C.toggle(el));

  UI.head = (title, sub, actions) => '<div class="ph"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="muted">' + sub + '</p>' : '') + '</div><div class="row gap wrap">' + (actions || '') + '</div></div>';
  UI.chip = (t, k) => '<span class="chip ' + (k || '') + '">' + esc(t) + '</span>';
  const ST = { draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', live: 'Live', paused: 'Paused' };
  UI.status = s => '<span class="chip st-' + s + '">' + esc(ST[s] || s) + '</span>';
  UI.empty = (msg, action) => '<div class="empty"><p>' + esc(msg) + '</p>' + (action || '') + '</div>';
  UI.tabs = (items, cur) => '<nav class="tabs" aria-label="Sections">' + items.map(t => '<a href="' + t[0] + '"' + (t[2] === cur ? ' aria-current="page"' : '') + '>' + esc(t[1]) + '</a>').join('') + '</nav>';
  UI.kpi = (label, value, sub, delta, spark) => {
    let d = '';
    if (delta != null && isFinite(delta)) d = '<span class="delta ' + (delta >= 0 ? 'up' : 'down') + '">' + (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta * 100).toFixed(1) + '%</span>';
    return '<div class="kpi card"><div class="kl">' + esc(label) + '</div><div class="kv">' + value + '</div><div class="ks">' + d + (sub ? '<span class="muted">' + sub + '</span>' : '') + '</div>' + (spark || '') + '</div>';
  };
  UI.pager = (total, page, size, act) => {
    const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return '';
    return '<div class="pager row gap"><button class="btn sm" data-act="' + act + '" data-p="' + (page - 1) + '"' + (page <= 0 ? ' disabled' : '') + '>← Prev</button><span class="muted">Page ' + (page + 1) + ' of ' + pages + ' · ' + U.num(total) + ' rows</span><button class="btn sm" data-act="' + act + '" data-p="' + (page + 1) + '"' + (page >= pages - 1 ? ' disabled' : '') + '>Next →</button></div>';
  };
  UI.frame = (html, o) => { o = o || {}; return '<iframe class="pframe' + (o.mobile ? ' mobile' : '') + '" sandbox="" title="' + esc(o.title || 'Email preview') + '" loading="lazy" style="height:' + (o.h || 560) + 'px" srcdoc="' + esc(html) + '"></iframe>'; };
  UI.thumb = html => '<div class="thumb"><iframe sandbox="" tabindex="-1" aria-hidden="true" title="" loading="lazy" srcdoc="' + esc(html) + '"></iframe></div>';
  UI.avatar = p => '<span class="av" style="background:hsl(' + (U.hash(p.em) % 360) + ',38%,42%)">' + esc((p.fn[0] || '?') + (p.ln[0] || '')) + '</span>';
  UI.name = p => esc(p.fn + ' ' + p.ln);
  UI.consentChips = p => (p.sup ? UI.chip('suppressed: ' + p.sup, 'bad') : p.ce ? UI.chip('email', 'good') : UI.chip('no email consent', 'muted')) + ' ' + (p.ssup ? UI.chip('SMS stop', 'bad') : p.cs ? UI.chip('sms', 'good') : '');

  /* profile picker */
  UI.pickProfile = () => new Promise(res => {
    let val = null;
    const d = U.dialog('<label class="fld"><span>Search by name, email or phone</span><input type="search" id="pk-q" autocomplete="off"></label><div id="pk-r" class="plist"></div>', { title: 'Choose a profile', onClose: () => res(val) });
    const draw = () => { const q = d.q('#pk-q').value, l = q ? E.search(q, 8) : E.db.profiles.slice(0, 6); d.q('#pk-r').innerHTML = l.map(p => '<button type="button" class="prow" data-id="' + p.id + '">' + UI.avatar(p) + '<span><b>' + UI.name(p) + '</b><br><span class="muted">' + esc(p.em) + '</span></span></button>').join('') || '<p class="muted">No matches.</p>'; };
    d.q('#pk-q').oninput = draw; draw();
    d.q('#pk-r').onclick = e => { const b = e.target.closest('[data-id]'); if (b) { val = E.P.get(+b.dataset.id); d.close(); } };
  });

  /* condition editor: edits a { mode, rows } object in place */
  const OPS = { str: [['eq', 'is'], ['ne', 'is not'], ['contains', 'contains'], ['set', 'is set'], ['unset', 'is not set']], bool: [['eq', 'is'], ['ne', 'is not']], date: [['within', 'within the last (days)'], ['older', 'older than (days)'], ['anniv', 'anniversary in next (days)'], ['set', 'is set'], ['unset', 'is not set']] };
  const CMP = [['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['eq', '=']];
  const DEF = { prop: () => ({ t: 'prop', f: 'cc', op: 'eq', v: 'SI' }), did: () => ({ t: 'did', ev: 'order', op: 'did', days: 90, min: 1 }), pred: () => ({ t: 'pred', f: 'orders', op: 'gte', v: 1 }), list: () => ({ t: 'list', op: 'in', v: E.db.lists[0].id }), seg: () => ({ t: 'seg', op: 'in', v: E.db.segments[0].id }), consent: () => ({ t: 'consent', f: 'email', op: 'yes' }) };
  const TYPES = [['prop', 'Profile property'], ['did', 'Behaviour'], ['pred', 'Metric / prediction'], ['list', 'List membership'], ['seg', 'Segment membership'], ['consent', 'Consent']];
  UI.condEditor = (host, def, o) => {
    o = o || {}; def.rows = def.rows || []; def.mode = def.mode || 'all';
    const sel = (k, i, opts, cur) => '<select data-k="' + k + '" data-i="' + i + '" aria-label="' + k + '">' + U.opts(opts, cur) + '</select>';
    const inp = (k, i, v, type, w) => '<input data-k="' + k + '" data-i="' + i + '" type="' + (type || 'text') + '" value="' + esc(v == null ? '' : v) + '" style="width:' + (w || 110) + 'px" aria-label="' + k + '">';
    const row = (c, i) => {
      let h = sel('t', i, TYPES, c.t);
      switch (c.t) {
        case 'prop': {
          const f = E.PROP_FIELDS.find(x => x.k === c.f) || E.PROP_FIELDS[0];
          h += sel('f', i, E.PROP_FIELDS.map(x => [x.k, x.label]), c.f) + sel('op', i, OPS[f.type], c.op);
          if (['set', 'unset'].indexOf(c.op) < 0) h += f.type === 'bool' ? sel('v', i, [['true', 'yes'], ['false', 'no']], String(c.v)) : f.opts && c.op !== 'contains' ? sel('v', i, f.opts, c.v) : inp('v', i, c.v, f.type === 'date' ? 'number' : 'text');
          break;
        }
        case 'did': h += sel('op', i, [['did', 'has'], ['not', 'has not']], c.op) + sel('ev', i, E.EVENT_TYPES.map(x => [x[0], x[1].toLowerCase()]), c.ev) + '<span class="muted">in last</span>' + inp('days', i, c.days, 'number', 70) + '<span class="muted">days (0 = ever)</span>' + (c.op === 'did' ? '<span class="muted">at least</span>' + inp('min', i, c.min || 1, 'number', 60) + '<span class="muted">times</span>' : ''); break;
        case 'pred': h += sel('f', i, E.PRED_FIELDS.map(x => [x.k, x.label]), c.f) + sel('op', i, CMP, c.op) + inp('v', i, c.v, 'number', 90); break;
        case 'list': h += sel('op', i, [['in', 'is in'], ['out', 'is not in']], c.op) + sel('v', i, E.db.lists.map(l => [l.id, l.name]), c.v); break;
        case 'seg': h += sel('op', i, [['in', 'is in'], ['out', 'is not in']], c.op) + sel('v', i, E.db.segments.filter(s => s.id !== o.self).map(s => [s.id, s.name]), c.v); break;
        case 'consent': h += sel('f', i, [['email', 'Email'], ['sms', 'SMS']], c.f) + sel('op', i, [['yes', 'subscribed'], ['no', 'not subscribed']], c.op); break;
      }
      return '<div class="crow">' + h + '<button type="button" class="btn ghost sm" data-del="' + i + '" aria-label="Remove condition">✕</button></div>';
    };
    const draw = () => {
      host.innerHTML = '<div class="row gap center"><span>Profiles who match</span><select data-mode aria-label="Match mode">' + U.opts([['all', 'ALL'], ['any', 'ANY']], def.mode) + '</select><span>of these conditions</span></div>' + def.rows.map(row).join('') + '<div><button type="button" class="btn sm" data-add>+ Add condition</button></div>';
    };
    const changed = () => { if (o.onChange) o.onChange(def); };
    host.onchange = host.oninput = e => {
      const t = e.target;
      if (t.hasAttribute('data-mode')) { def.mode = t.value; changed(); return; }
      const k = t.dataset.k; if (!k) return; const c = def.rows[+t.dataset.i]; if (!c) return;
      if (k === 't') { def.rows[+t.dataset.i] = DEF[t.value](); draw(); changed(); return; }
      c[k] = t.type === 'number' ? (t.value === '' ? 0 : +t.value) : t.value;
      if (e.type === 'change' && (k === 'f' || k === 'op')) {
        if (c.t === 'prop' && k === 'f') { const f = E.PROP_FIELDS.find(x => x.k === c.f); c.op = OPS[f.type][0][0]; c.v = f.type === 'bool' ? 'true' : f.type === 'date' ? 30 : f.opts ? f.opts[0] : ''; }
        draw();
      }
      changed();
    };
    host.onclick = e => {
      if (e.target.closest('[data-add]')) { def.rows.push(DEF.prop()); draw(); changed(); }
      const d = e.target.closest('[data-del]'); if (d) { def.rows.splice(+d.dataset.del, 1); draw(); changed(); }
    };
    draw();
    return { redraw: draw };
  };
})();
