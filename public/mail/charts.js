/* AM.C: hand-made SVG charts (bar, line, horizontal bar, sparkline) with a "Table" view */
(function () {
  const AM = window.AM = window.AM || {}, U = AM.U, esc = U.esc;
  const C = AM.C = { reg: {} };
  let seq = 0;
  const nice = (max, n) => { if (max <= 0) return [1, 0.25]; const raw = max / (n || 4), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, s = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; return [Math.ceil(max / s) * s, s]; };
  const fmtDefault = v => Math.abs(v) >= 1000 ? U.num(v) : (Math.round(v * 10) / 10).toString();
  const legend = ss => ss.length > 1 ? '<div class="legend">' + ss.map((s, i) => '<span><i class="sw s' + (i % 6) + '"></i>' + esc(s.name) + '</span>').join('') + '</div>' : '';
  const table = (labels, ss, fmt, lab0) => '<table class="tbl sm"><thead><tr><th>' + esc(lab0 || '') + '</th>' + ss.map(s => '<th class="r">' + esc(s.name) + '</th>').join('') + '</tr></thead><tbody>' + labels.map((l, i) => '<tr><td>' + esc(l) + '</td>' + ss.map(s => '<td class="r">' + esc(fmt(s.values[i])) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const fig = (id, title, svg, tbl, ss, extra) => '<figure class="chart" id="' + id + '" role="group" aria-label="' + esc(title) + '"><figcaption><span>' + esc(title) + '</span><span class="row gap"><button type="button" class="btn ghost sm" data-act="chart-tbl" aria-pressed="false">Table</button>' + (extra || '') + '</span></figcaption>' + legend(ss) + '<div class="cv">' + svg + '</div><div class="ct" hidden>' + tbl + '</div></figure>';
  const axis = (W, H, pad, top, max, step, fmt) => { let g = ''; for (let v = 0; v <= max + 1e-9; v += step) { const y = top + (H - pad - top) * (1 - v / max); g += '<line class="grid" x1="' + 46 + '" x2="' + (W - 8) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="42" y="' + (y + 4) + '" text-anchor="end">' + esc(fmt(v)) + '</text>'; } return g; };
  function barSvg(o) {
    const W = 640, H = o.h || 220, pad = 28, top = 10, n = o.labels.length, ss = o.series, fmt = o.fmt || fmtDefault;
    const max0 = o.stacked ? Math.max.apply(null, o.labels.map((l, i) => U.sum(ss, s => s.values[i] || 0))) : Math.max.apply(null, ss.map(s => Math.max.apply(null, s.values.concat(0))));
    const [max, step] = nice(max0, 4), bw = (W - 54) / Math.max(1, n), gw = bw * 0.72, sw = o.stacked ? gw : gw / ss.length;
    let g = axis(W, H, pad, top, max, step, fmt);
    const every = Math.ceil(n / 12);
    o.labels.forEach((l, i) => {
      const x0 = 50 + i * bw + (bw - gw) / 2; let acc = 0;
      ss.forEach((s, j) => {
        const v = s.values[i] || 0, h = (H - pad - top) * v / max, x = o.stacked ? x0 : x0 + j * sw, y = o.stacked ? H - pad - (H - pad - top) * (acc + v) / max : H - pad - h;
        acc += v; g += '<rect class="s' + (j % 6) + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, sw - 1).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="2"><title>' + esc(l + ' · ' + s.name + ': ' + fmt(v)) + '</title></rect>';
      });
      if (i % every === 0) g += '<text class="ax" x="' + (50 + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(l) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(o.title || 'Bar chart') + '">' + g + '</svg>';
  }
  function lineSvg(o) {
    const W = 640, H = o.h || 220, pad = 28, top = 10, n = o.labels.length, ss = o.series, fmt = o.fmt || fmtDefault;
    const [max, step] = nice(Math.max.apply(null, ss.map(s => Math.max.apply(null, s.values.concat(0)))), 4), dx = (W - 62) / Math.max(1, n - 1);
    let g = axis(W, H, pad, top, max, step, fmt); const every = Math.ceil(n / 10);
    o.labels.forEach((l, i) => { if (i % every === 0) g += '<text class="ax" x="' + (52 + i * dx).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(l) + '</text>'; });
    ss.forEach((s, j) => {
      const pts = s.values.map((v, i) => [52 + i * dx, H - pad - (H - pad - top) * (v || 0) / max]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if (o.area && j === 0) g += '<path class="area s' + j + '" d="' + d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - pad) + 'Z"/>';
      g += '<path class="line s' + (j % 6) + '" d="' + d + '"/>';
      if (n <= 40) pts.forEach((p, i) => { g += '<circle class="dot s' + (j % 6) + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3"><title>' + esc(o.labels[i] + ' · ' + s.name + ': ' + fmt(s.values[i])) + '</title></circle>'; });
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(o.title || 'Line chart') + '">' + g + '</svg>';
  }
  function hbarSvg(o) {
    const rows = o.rows, W = 640, rh = 30, H = rows.length * rh + 6, fmt = o.fmt || fmtDefault, max = Math.max.apply(null, rows.map(r => r.value).concat(o.max || 0.0001)), lw = 180;
    let g = '';
    rows.forEach((r, i) => {
      const y = 4 + i * rh, w = (W - lw - 90) * r.value / max;
      g += '<text class="ax lbl" x="' + (lw - 8) + '" y="' + (y + 17) + '" text-anchor="end">' + esc(String(r.label).length > 28 ? String(r.label).slice(0, 27) + '…' : r.label) + '</text><rect class="s' + ((r.c || 0) % 6) + '" x="' + lw + '" y="' + (y + 4) + '" width="' + Math.max(1, w).toFixed(1) + '" height="18" rx="3"><title>' + esc(r.label + ': ' + fmt(r.value)) + '</title></rect><text class="ax val" x="' + (lw + Math.max(1, w) + 6).toFixed(1) + '" y="' + (y + 17) + '">' + esc(fmt(r.value)) + (r.sub ? ' · ' + esc(r.sub) : '') + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(o.title || 'Bar chart') + '">' + g + '</svg>';
  }
  const make = (kind, o) => {
    const id = 'ch' + (++seq), fmt = o.fmt || fmtDefault; C.reg[id] = () => kind === 'bar' ? barSvg(o) : kind === 'line' ? lineSvg(o) : hbarSvg(o);
    const ss = o.series || [{ name: o.valueName || 'Value', values: (o.rows || []).map(r => r.value) }], labels = o.labels || o.rows.map(r => r.label);
    return fig(id, o.title || '', C.reg[id](), table(labels, ss, fmt, o.labelName), kind === 'hbar' ? [] : ss, o.extra);
  };
  C.bar = o => make('bar', o); C.line = o => make('line', o); C.hbar = o => make('hbar', o);
  C.spark = (vals, o) => {
    o = o || {}; const W = o.w || 90, H = o.h || 24, max = Math.max.apply(null, vals.concat(0.0001)), dx = W / Math.max(1, vals.length - 1);
    const d = vals.map((v, i) => (i ? 'L' : 'M') + (i * dx).toFixed(1) + ' ' + (H - 2 - (H - 4) * v / max).toFixed(1)).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><path class="line s0" d="' + d + '"/></svg>';
  };
  C.redraw = () => { Object.keys(C.reg).forEach(id => { const el = document.getElementById(id); if (el) { const cv = el.querySelector('.cv'); if (cv) cv.innerHTML = C.reg[id](); } else delete C.reg[id]; }); };
  C.toggle = btn => { const f = btn.closest('figure'), t = f.querySelector('.ct'), on = t.hidden; t.hidden = !on; f.querySelector('.cv').hidden = on; btn.setAttribute('aria-pressed', on ? 'true' : 'false'); btn.textContent = on ? 'Chart' : 'Table'; };
  window.addEventListener('adrial-theme', () => C.redraw());
})();
