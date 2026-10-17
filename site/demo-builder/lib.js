/* Pure helpers of the branded demo editor (site/demo-builder/app.js); no DOM, so Node can test them (tools/tests/branded-demo.test.js). */
(function (root) {
  'use strict';
  /** What kind of image these bytes are (by their first bytes, not by the file name): 'png' | 'jpeg' | 'webp' | null. */
  function sniff(b) {
    if (!b || b.length < 12) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }
  /** width and height scaled down so that neither is above max (never up) */
  function fit(w, h, max) { var k = Math.min(1, max / Math.max(w, h)); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; }
  function hex(r, g, b) { return '#' + [r, g, b].map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }
  /** The n most characteristic colours of an image (RGBA pixels, e.g. canvas getImageData().data) as #rrggbb, most prominent first.
   * Transparent and near-white pixels are ignored; colourful pixels count more than grey ones; colours closer than 60 (RGB distance) merge. */
  function dominant(data, n) {
    var buckets = {}, i;
    for (i = 0; i + 3 < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128 || (r > 238 && g > 238 && b > 238)) continue;
      var key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4), mx = Math.max(r, g, b), mn = Math.min(r, g, b), w = 1 + 3 * (mx ? (mx - mn) / mx : 0);
      var k = buckets[key] || (buckets[key] = { w: 0, r: 0, g: 0, b: 0, n: 0 });
      k.w += w; k.r += r; k.g += g; k.b += b; k.n++;
    }
    var list = Object.keys(buckets).map(function (x) { var k = buckets[x]; return { w: k.w, c: [k.r / k.n, k.g / k.n, k.b / k.n] }; }).sort(function (x, y) { return y.w - x.w; });
    var out = [];
    list.forEach(function (x) {
      if (out.length >= n) return;
      var near = out.some(function (o) { return Math.sqrt(Math.pow(o[0] - x.c[0], 2) + Math.pow(o[1] - x.c[1], 2) + Math.pow(o[2] - x.c[2], 2)) < 60; });
      if (!near) out.push(x.c);
    });
    return out.map(function (c) { return hex(c[0], c[1], c[2]); });
  }
  /** YYYY-MM-DD, days after now (UTC) */
  function expiryIn(nowMs, days) { return new Date(nowMs + days * 864e5).toISOString().slice(0, 10); }
  /** "opened 3 times, last 17 Oct 14:12" / "not opened yet" */
  function viewsText(v, tz) {
    if (!v || !v.count) return 'not opened yet';
    var d = new Date(v.last), o = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
    if (tz) o.timeZone = tz;
    var when = isNaN(d) ? '' : ', last ' + d.toLocaleString('en-GB', o).replace(',', '');
    return 'opened ' + (v.count === 1 ? 'once' : v.count + ' times') + when;
  }
  var api = { sniff: sniff, fit: fit, dominant: dominant, expiryIn: expiryIn, viewsText: viewsText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DemoBuilderLib = api;
})(typeof window !== 'undefined' ? window : this);
