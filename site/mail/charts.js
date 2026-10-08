/* Adrial Mail — hand-made SVG charts (bars, stacked bars, lines). Colours come from CSS variables;
 * every drawn chart is re-rendered on 'adrial-theme' and on resize. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, esc = U.esc;
  var C = AM.C = {};
  var reg = [];

  function nice(max) {
    if (max <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function remember(el, fn, o) {
    reg = reg.filter(function (x) { return x.el !== el && document.contains(x.el); });
    reg.push({ el: el, fn: fn, o: o });
  }
  C.redraw = function () { reg = reg.filter(function (x) { return document.contains(x.el); }); reg.forEach(function (x) { x.fn(x.el, x.o, true); }); };
  window.addEventListener('adrial-theme', function () { C.redraw(); });
  window.addEventListener('resize', U.debounce(C.redraw, 150));

  function tipFor(el) {
    var t = el.querySelector('.tip'); if (!t) { t = document.createElement('div'); t.className = 'tip'; t.hidden = true; el.appendChild(t); }
    return t;
  }
  function legend(series) {
    return '<div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s.color + (s.dash ? ';height:2px' : '') + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>';
  }
  function hover(el, svg, o, n, x0, gw, fmt) {
    var tip = tipFor(el);
    svg.addEventListener('mousemove', function (e) {
      var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
      var i = Math.floor((x - x0) / gw); if (i < 0 || i >= n) { tip.hidden = true; return; }
      tip.innerHTML = '<b>' + esc(o.labels[i]) + '</b>' + o.series.map(function (s) { return '<br><span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span> ' + esc((s.fmt || fmt)(s.values[i] || 0)); }).join('') + (o.total ? '<br><span>Total</span> ' + esc(fmt(o.series.reduce(function (a, s) { return a + (s.values[i] || 0); }, 0))) : '');
      tip.hidden = false;
      var er = el.getBoundingClientRect();
      tip.style.left = Math.min(er.width - 90, Math.max(90, e.clientX - er.left)) + 'px';
      tip.style.top = (e.clientY - er.top - 12) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; });
  }
  // o: {labels, series:[{name,color,values}], stacked, height, fmt, yfmt, total, legend}
  C.bars = function (el, o, again) {
    if (!again) remember(el, C.bars, o);
    var W = Math.max(260, el.clientWidth || 600), H = o.height || 220, L = 46, R = 8, T = 10, B = 26;
    var n = o.labels.length, fmt = o.fmt || U.n, yfmt = o.yfmt || U.short;
    var max = 0;
    for (var i = 0; i < n; i++) {
      if (o.stacked) { var s = 0; o.series.forEach(function (x) { s += x.values[i] || 0; }); max = Math.max(max, s); }
      else o.series.forEach(function (x) { max = Math.max(max, x.values[i] || 0); });
    }
    max = nice(max * 1.05);
    var gw = (W - L - R) / Math.max(1, n), y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' + esc(o.aria || 'Bar chart') + '">';
    for (var g = 0; g <= 4; g++) { var v = max * g / 4, yy = y(v); svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L - 8) + '" y="' + (yy + 4) + '" text-anchor="end">' + esc(yfmt(v)) + '</text>'; }
    var step = Math.max(1, Math.ceil(n * 46 / (W - L - R)));
    for (i = 0; i < n; i++) {
      var x = L + i * gw, bw = Math.max(2, Math.min(42, gw * 0.62));
      if (o.stacked) {
        var acc = 0;
        o.series.forEach(function (sr, si) {
          var val = sr.values[i] || 0; if (!val) return;
          var y1 = y(acc + val), y0 = y(acc); acc += val;
          svg += '<rect x="' + (x + (gw - bw) / 2) + '" y="' + y1 + '" width="' + bw + '" height="' + Math.max(0.5, y0 - y1) + '" rx="' + (si === o.series.length - 1 ? 3 : 0) + '" style="fill:' + sr.color + '"/>';
        });
      } else {
        var k = o.series.length, bw2 = Math.max(2, Math.min(26, gw * 0.7 / k));
        o.series.forEach(function (sr, si) {
          var val = sr.values[i] || 0, yv = y(val);
          svg += '<rect x="' + (x + (gw - bw2 * k) / 2 + si * bw2) + '" y="' + yv + '" width="' + (bw2 - 1) + '" height="' + Math.max(0.5, y(0) - yv) + '" rx="2" style="fill:' + sr.color + '"/>';
        });
      }
      if (i % step === 0) svg += '<text x="' + (x + gw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(o.labels[i]) + '</text>';
    }
    svg += '<line class="base" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></svg>';
    el.innerHTML = (o.legend !== false && o.series.length > 1 ? legend(o.series) : '') + svg;
    hover(el, el.querySelector('svg'), o, n, L, gw, fmt);
  };
  // o: {labels, series:[{name,color,values,dash,area}], height, fmt, yfmt, max}
  C.line = function (el, o, again) {
    if (!again) remember(el, C.line, o);
    var W = Math.max(260, el.clientWidth || 600), H = o.height || 200, L = 46, R = 10, T = 10, B = 26;
    var n = o.labels.length, fmt = o.fmt || U.n, yfmt = o.yfmt || U.short, max = o.max || 0;
    o.series.forEach(function (s) { s.values.forEach(function (v) { max = Math.max(max, v || 0); }); });
    max = o.max || nice(max * 1.08);
    var gw = (W - L - R) / Math.max(1, n), X = function (i) { return L + gw * i + gw / 2; }, Y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="' + esc(o.aria || 'Line chart') + '">';
    for (var g = 0; g <= 4; g++) { var v = max * g / 4; svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + esc(yfmt(v)) + '</text>'; }
    var step = Math.max(1, Math.ceil(n * 46 / (W - L - R)));
    for (var i = 0; i < n; i += step) svg += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(o.labels[i]) + '</text>';
    o.series.forEach(function (s) {
      var pts = s.values.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v || 0).toFixed(1); });
      if (s.area) svg += '<path d="M' + X(0) + ',' + Y(0) + 'L' + pts.join('L') + 'L' + X(n - 1) + ',' + Y(0) + 'Z" style="fill:' + s.color + ';opacity:.12"/>';
      svg += '<polyline points="' + pts.join(' ') + '" fill="none" style="stroke:' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
      if (n <= 16) s.values.forEach(function (v, i) { svg += '<circle cx="' + X(i) + '" cy="' + Y(v || 0) + '" r="2.6" style="fill:' + s.color + '"/>'; });
    });
    svg += '<line class="base" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/></svg>';
    el.innerHTML = (o.legend !== false && o.series.length > 1 ? legend(o.series) : '') + svg;
    hover(el, el.querySelector('svg'), o, n, L, gw, fmt);
  };
  // Horizontal bars list (HTML) for rankings.
  C.hbars = function (rows, fmt) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
    return '<div class="hbars">' + rows.map(function (r) {
      return '<div class="hb"><div class="hb-l">' + (r.href ? '<a href="' + esc(r.href) + '">' + esc(r.label) + '</a>' : esc(r.label)) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</div><div class="hb-t"><i style="width:' + (100 * r.v / max).toFixed(1) + '%;background:' + (r.color || 'var(--accent)') + '"></i></div><div class="hb-v num">' + esc((fmt || U.n)(r.v)) + '</div></div>';
    }).join('') + '</div>';
  };
  C.spark = function (values, color) {
    var W = 96, H = 26, max = Math.max.apply(null, values.concat([1]));
    var pts = values.map(function (v, i) { return (i * W / Math.max(1, values.length - 1)).toFixed(1) + ',' + (H - 2 - (H - 4) * v / max).toFixed(1); }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><polyline points="' + pts + '" fill="none" style="stroke:' + (color || 'var(--accent)') + '" stroke-width="1.6"/></svg>';
  };
})();
