/*
 * Business Apps — "Fluent suite" icon kit
 * =====================================
 * Plain ES module, no dependencies (sharp is only used by build.mjs and tools/make-icons.mjs). One icon = one SVG, viewBox 1024 × 1024.
 *
 *   import { render, measure, K, LOOK, RAMPS, MARKS, addMark, addRamp, ...helpers } from './kit.mjs';
 *   render(spec, { shape = 'squircle', size = 1024, uid = '' })  ->  SVG string
 *     shape 'full'      full-bleed square for the iPhone home screen / apple-touch-icon (iOS applies its own mask).
 *                       White-tile apps get the white tile colour edge to edge; the launcher its near-black tile.
 *           'squircle'  Apple continuous-corner rounded rectangle (22.37 %, G2 blends), transparent outside, with
 *                       the faint edge line: a 9 % ink hairline on white tiles, a machined edge light on dark ones.
 *           'maskable'  full background, the mark scaled ×0.82 into the central 72 % (inside the W3C safe circle).
 *     size  SVG width/height in px (the viewBox stays 1024).
 *     only  'tile' (no mark) | 'mark' (no tile) — for measuring; inkInlays: true draws inlays in the deep tone so a
 *           raster measure counts the € / check as ink (build.mjs uses both).
 *     uid   extra suffix when the same app + shape appears twice on one page. Every id in the SVG is
 *           `${spec.id}-${shape}[-uid]-…`, so dozens of icons can be inlined together.
 *   measure(spec) -> the mark's bounding box as % of the tile (after LOOK.scale) and its centre; build.mjs adds a
 *                    raster check (ink coverage and optical centre).
 *
 * WHAT AN ICON IS
 *   A white tile (the launcher alone: a near-black tile) carrying ONE mark: an abstract, logo-like
 *   figure of 2–4 flat PLANES in tones of ONE colour ramp, plus at most one white INLAY (a simple glyph on the
 *   front plate). Microsoft 365 / Fluent spirit: layered geometry, soft tonal gradients, a soft shadow only where
 *   a plane lies on another plus one soft shadow of the whole mark. No gloss, no rim, no bevel, no outlines, no text.
 *
 * CONSTRUCTION RULES (every mark follows them, so 34 icons look designed by one team)
 *   1. Grid. 1024 canvas, module K.G = 32. Draw every mark in the LIVE AREA 6G..26G = 192..832 (640 units) and
 *      touch it on the mark's long side (round marks may overshoot by ≤ 0.5G). Render scales the art by
 *      LOOK.scale = 1.06 about the centre, so marks fill ≈ 66 % of the tile and never leave the central 75 %.
 *      Wide or tall marks: the short side is free. Centre the bounding box, then nudge ≤ 24 units (steps of 8)
 *      for optical balance: bottom-heavy marks (people, columns, Λ, calendars) up, a plate-at-lower-right
 *      composition a little right. build.mjs prints the box centre and the ink centroid of every mark.
 *   2. Shared radii and weights (K): big planes (sheets, discs, cards) R = 48; bars and columns Rb = 32; small
 *      parts (folds, tabs, teeth, cells) r = 20; circles and arcs exact. Rings and arcs are W = 112 thick; bold
 *      bars (legs, handles, arms, chart columns) Wb = 144, measured square to the bar. Detail bars printed on a
 *      plane are w = 44 (fully round); inlay strokes wi = 40. Columns: col = 144 wide, colGap = 56 apart.
 *   3. Tone by depth (lit from the top left). Each colour is a 5-step RAMP, 0 lightest … 4 deepest; a plane's
 *      ROLE sets its tones (fractional ramp positions, gradient along one fixed 63° axis, light top-left → deep
 *      bottom-right):
 *        back    0.5 → 1.6   the large light plane at the back (the sheet, the track, the far person)
 *        mid     1.3 → 2.7   the second plane
 *        front   2.2 → 3.9   the plate nearest to the viewer — always the deepest
 *        accent  2.2 → 3.9   of spec.accent — ONLY for a status plate (a check); one per icon at most
 *        detail  flat tone (default 2.3), no shadow: small marks printed on a plane (text lines, day cells).
 *                A big back plane that carries details may go lighter (tone [0.2, 1.2]) so the front plate pops.
 *        inlay   flat white, no shadow: the ONE glyph on the front plate (€, clock hands, check, eyelet)
 *      Lighter back, deeper front: never put a light plane in front of a deep one (except a lid/top face).
 *   4. Depth. A front plane casts a soft shadow ONLY onto the planes behind it (LOOK.overlap), the whole mark
 *      casts one soft ground shadow (LOOK.ground), and each plane carries the same faint top-left light
 *      (LOOK.light, 16 % white). Where a front plate sits ON another plane, give it `gap: true`: a K.gap = 28
 *      tile-coloured moat is cut round it out of the planes behind, and its shadow falls just outside the moat.
 *      That keeps overlaps crisp at 60 px, where shadows blur away. A fill inside its own track (a progress or
 *      budget column) uses the thinner K.seam = 14. Small parts (binder rings, tabs) may use gap: 20.
 *   5. Tile. White → cool white (#FFFFFF → #F1F3F7) with a 9 % ink hairline. The dark tile is the launcher's alone
 *      (every app, Clearfigure included, sits on white, so the brand owns its tile). Dark tiles (tile: 'dark'): #1D1B26 →
 *      #0C0C0D with a soft bloom of the app colour behind the mark, a slight top lift and a machined edge light
 *      (white 34 % at the top → 5 % at the bottom) so they hold their edge on dark wallpapers.
 *   6. Colour. One ramp per app (+ an accent ramp only for a status plate, a check, or a threshold line printed
 *      flat). Apps of one home-page group never share a ramp; violet (≈ 251°) is the suite brand and belongs to the
 *      launcher only: app ramps stay out of BRAND_BAND (222–282°) and build.mjs warns when a rendered mark's median
 *      hue comes within 30° of it. Grown-up colours: deep blue, emerald, crimson, amber, berry, teal, slate…; no
 *      neon, no candy gradients, no hue-less grey (it reads as a disabled or system app).
 *   7. Weight. Every mark covers 22–32 % of the tile (build.mjs: 'cover'): give a thin stroke mark a light back
 *      plane, shrink a heavy slab mark, so no icon looks like an outline next to a solid one.
 *   8. Meaning. One logo-like concept per app, said by the silhouette; related apps never share a mark idea, and
 *      every icon must be told apart by outline AND colour at 60 px on light and dark wallpapers.
 *   No text, no external images, no CSS, no feTurbulence, no foreignObject.
 *
 * SPEC (one object per app)
 *   { id: 'billing', name: 'Billing', group: 'Finance',
 *     hue: 'blue',            // RAMPS key (or an array of 5 hex stops, lightest → deepest)
 *     accent: 'emerald',      // optional second ramp, for role 'accent' only
 *     tile: 'light' | 'dark', // default 'light'
 *     mark: 'receiptCoin',    // MARKS key (or a function (args, K) => planes)
 *     args: {},               // optional, passed to the mark
 *     nudge: [dx, dy] }       // optional optical nudge of the whole mark, ≤ 24 units each (steps of 8)
 *
 * MARKS — (args, K) => planes, listed back to front. A plane is
 *   { role: 'back'|'mid'|'front'|'accent'|'detail'|'inlay',
 *     d,                 // one shape or an array of shapes; a shape is a segment list [['M',x,y],['L',x,y],
 *                        //   ['C',…],['A',rx,ry,rot,large,sweep,x,y],['Z']]. Use the helpers below.
 *     tone?: [a, b],     // override the role's ramp positions (sparingly — e.g. a lid lighter than the slab)
 *     hue?: 'accent',    // take the accent ramp
 *     gap?: true|number, // cut a moat (default K.gap) round this plane out of every plane behind it
 *     cut?: shapes,      // shapes knocked out of this plane only (a wrench jaw, a ring hole)
 *     cast?: false,      // this plane casts no shadow on the planes behind
 *     color?: '#hex' }   // inlay colour (default white)
 *
 * HOW TO ADD A MARK (example, tested: an open envelope with a card rising out of it)
 *
 *   import { addMark, rect, roundPoly, K } from './kit.mjs';
 *   addMark('openMail', () => {
 *     const x = 192, w = 640, top = 470, bot = 832, notch = 96;                   // touches the live area's width
 *     return [
 *       { role: 'back', d: roundPoly([[x, bot - 40], [x, top], [512, 300], [x + w, top], [x + w, bot - 40]],
 *           [K.R, K.r, K.r, K.r, K.R]) },                                          // inside + raised flap
 *       { role: 'mid', d: rect(312, 216, 400, 380, K.R) },                         // the card
 *       { role: 'front', d: roundPoly([[x, bot], [x, top], [512, top + notch], [x + w, top], [x + w, bot]],
 *           [K.R, K.r, 2 * K.R, K.r, K.R]) },                                      // the pocket, shallow V top
 *     ];
 *   });
 *   // spec: { id: 'mail', name: 'Clearfigure Mail', group: 'Sales & marketing', hue: 'blue', mark: 'openMail' }
 *   // (Mail ships a paper plane leaving the envelope instead, 'sendMail' in tools/icons/specs.mjs: a card rising
 *   //  out of a pocket was shared by three apps, so it no longer told them apart)
 *   // then: node tools/icons/build.mjs my-specs.mjs out/   and look at out/sheet.png at 60 px on both wallpapers;
 *   // node tools/make-icons.mjs writes the icons the site uses.
 *
 * HOW TO ADD A RAMP: addRamp('forest', ['#A9DDB0', '#5DB36A', '#2E8B45', '#1F6B34', '#124622']) — five stops,
 *   lightest → deepest, step 2 ≈ the brand colour, step 4 dark enough for a white inlay (contrast ≥ 4.5).
 */

// ───────────────────────────── construction constants ─────────────────────────────
export const K = {
  G: 32, c: 512, live: [192, 832],
  R: 48, Rb: 32, r: 20,              // radii: big planes, bars/columns, small parts
  W: 112, Wb: 144, w: 44, wi: 40,    // weights: rings/arcs, bold bars (legs, handles, columns), detail bars, inlays
  col: 144, colGap: 56,              // chart columns (= Wb)
  gap: 28,                           // moat round a front plate
  seam: 14,                          // thinner moat for a fill inside its own track (budget actual in its envelope)
};

// ───────────────────────────── colour ─────────────────────────────
const hex2rgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
const rgb2hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };

/** Five-step ramps, 0 lightest … 4 deepest. Rich but grown-up: no neon, no brown-out at the deep end. */
export const RAMPS = {
  blue:     ['#9CCBFF', '#4E9BF2', '#1F6FDC', '#1552B4', '#0C3580'],   // Billing (Finance), Mail (Sales), Team Tasks (People & IT)
  cyan:     ['#A0E4FA', '#45BCE8', '#1496CC', '#0D74A6', '#074F75'],   // Cash forecast, Refill
  teal:     ['#8EE2E2', '#30BFC6', '#0D98A4', '#0A7483', '#06505D'],   // Time & leave, CS quality, Clearfigure
  emerald:  ['#8BE3BE', '#36C08C', '#0F9C6C', '#0A7A55', '#05543A'],   // Budget, Stores, Portal usage, Client Atlas; Recon's and Data check's accent
  olive:    ['#D5E39B', '#A6C24F', '#7E9C27', '#5F7A18', '#3F530C'],   // ERP, n8n Runs
  amber:    ['#FFD073', '#FDB12E', '#F2960B', '#D57605', '#A85A03'],   // Invoices, Service jobs, Analytics (golden, never brown)
  orange:   ['#FFC09A', '#FA8B4E', '#E8642A', '#C04A18', '#86300B'],   // Recon, Parcels, Joiners & leavers, Ads
  coral:    ['#FFB8A3', '#FF7D61', '#EE5236', '#C23A22', '#862312'],   // Marketing calendar
  crimson:  ['#FFA3AE', '#F2566F', '#D5244A', '#A9153A', '#740B29'],   // Collections, Desk, Margin guard
  rose:     ['#FFB0CD', '#F26A9D', '#D63A78', '#AE245E', '#7A1340'],   // Design Comparison
  berry:    ['#EFB6D9', '#D873AE', '#B23F86', '#8A2A68', '#561340'],   // CRM (muted magenta-plum, far from the brand violet)
  magenta:  ['#F3B3EA', '#DD6DCF', '#B93AA8', '#922887', '#5F155A'],   // Postbench, Branch Manager, Webshop (≈ 307°)
  violet:   ['#D6CCFF', '#9B88F5', '#7559EC', '#5B3FE0', '#3A24A8'],   // the suite brand: launcher only (≈ 251°)
  ink:      ['#B6CBEA', '#769AD2', '#3762AA', '#264888', '#142E5E'],   // Contracts, Pisarna DMS (deep legal-ink navy, ≈ 217°)
  slate:    ['#ADCBE5', '#6799C4', '#3A70A1', '#2A5682', '#18395A'],   // Data health check (saturated blue-slate, ≈ 209°)
  graphite: ['#CBD0D8', '#9AA2AE', '#6C7583', '#4C5461', '#2F3540'],   // spare (no hue: reads as disabled next to the suite)
  indigo:   ['#B5C0FF', '#7F8FF5', '#4F62DE', '#3A49B8', '#252F85'],   // retired (≈ 232°, inside the brand band)
  plum:     ['#E2B0F2', '#C06FDF', '#9640BE', '#742B9B', '#4D186B'],   // retired (≈ 281°, inside the brand band)
  brown:    ['#EBCDAA', '#CC9D69', '#A8743C', '#835628', '#583816'],   // spare (goes muddy: avoid)
};
/** App ramps stay out of this hue band round the brand violet (build.mjs warns when a rendered mark's median hue is
 *  within 30° of the launcher's). */
export const BRAND_BAND = [222, 282];
export const addRamp = (name, stops) => { if (stops.length !== 5) throw new Error('a ramp has 5 stops'); RAMPS[name] = stops; };
const ramp = (h) => (Array.isArray(h) ? h : RAMPS[h] || (() => { throw new Error(`unknown ramp ${h}`); })());
/** Colour at a fractional ramp position (0..4). */
export const toneAt = (R, t) => { t = Math.max(0, Math.min(4, t)); const i = Math.min(3, Math.floor(t)); return mix(R[i], R[i + 1], t - i); };

// ───────────────────────────── the look ─────────────────────────────
export const LOOK = {
  radius: 0.2237, smoothing: 0.6,                         // Apple continuous-corner tile
  roles: { back: [0.5, 1.6], mid: [1.3, 2.7], front: [2.2, 3.9], accent: [2.2, 3.9] },
  detailTone: 2.3,
  scale: 1.06,                                            // marks drawn on 192..832, shown 6 % larger (≈ 66 %)
  maskable: 0.82,                                         // extra scale for 'maskable'
  light: 0.16,                                            // soft top-left light inside each plane
  axis: 0.5,                                              // gradient axis: dx = axis · height (≈ 63°)
  overlap: { blur: 13, dy: 7, op: 0.34, darken: 0.45 },   // shadow a plane casts on the planes behind it
  ground: { blur: 20, dy: 16, op: 0.16, darken: 0.35, tight: 0.07 },
  tileLight: ['#FFFFFF', '#F1F3F7'],
  hairLight: ['#0F172A', 0.09, 16],                       // colour, opacity, stroke (half of it inside the tile)
  tileDark: ['#1D1B26', '#0C0C0D'],
  dark: { bloom: 0.34, lift: 0.07, edge: [0.34, 0.05], edgeW: 12 },
};

// ───────────────────────────── geometry ─────────────────────────────
const n2 = (v) => (Math.round(v * 100) / 100).toString();
export function pathD(segs) {
  return segs.map((s) => (s[0] === 'A'
    ? `A${n2(s[1])} ${n2(s[2])} ${n2(s[3])} ${s[4]} ${s[5]} ${n2(s[6])} ${n2(s[7])}`
    : s[0] + s.slice(1).map(n2).join(' '))).join('');
}
const isShape = (d) => Array.isArray(d) && typeof d[0]?.[0] === 'string';
export const shapesOf = (d) => (isShape(d) ? [d] : d.flatMap((x) => shapesOf(x)));

/** Affine place: scale s (or [sx, sy]), rotate rot° (clockwise) about the origin, then move to (x, y). */
export function place(d, { s = 1, rot = 0, x = 0, y = 0 } = {}) {
  if (!isShape(d)) return d.map((sh) => place(sh, { s, rot, x, y }));
  const [sx, sy] = Array.isArray(s) ? s : [s, s];
  const c = Math.cos((rot * Math.PI) / 180), sn = Math.sin((rot * Math.PI) / 180);
  const P = (px, py) => [px * sx * c - py * sy * sn + x, px * sx * sn + py * sy * c + y];
  const flip = sx * sy < 0;
  return d.map((g) => {
    switch (g[0]) {
      case 'M': case 'L': return [g[0], ...P(g[1], g[2])];
      case 'C': return ['C', ...P(g[1], g[2]), ...P(g[3], g[4]), ...P(g[5], g[6])];
      case 'Q': return ['Q', ...P(g[1], g[2]), ...P(g[3], g[4])];
      case 'A': return ['A', g[1] * Math.abs(sx), g[2] * Math.abs(sy), g[3] + rot, g[4], flip ? 1 - g[5] : g[5], ...P(g[6], g[7])];
      default: return g;
    }
  });
}
/** Mirror a shape about the vertical line x = ax. */
export const mirrorX = (d, ax = 512) => place(place(d, { x: -ax }), { s: [-1, 1], x: ax });
/** Rounded rectangle; r = number or [tl, tr, br, bl]. */
export function rect(x, y, w, h, r = 0) {
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.min(v, w / 2, h / 2));
  const s = [['M', x + tl, y], ['L', x + w - tr, y]];
  if (tr) s.push(['A', tr, tr, 0, 0, 1, x + w, y + tr]);
  s.push(['L', x + w, y + h - br]);
  if (br) s.push(['A', br, br, 0, 0, 1, x + w - br, y + h]);
  s.push(['L', x + bl, y + h]);
  if (bl) s.push(['A', bl, bl, 0, 0, 1, x, y + h - bl]);
  s.push(['L', x, y + tl]);
  if (tl) s.push(['A', tl, tl, 0, 0, 1, x + tl, y]);
  s.push(['Z']);
  return s;
}
export const circle = (cx, cy, r) => [['M', cx - r, cy], ['A', r, r, 0, 1, 1, cx + r, cy], ['A', r, r, 0, 1, 1, cx - r, cy], ['Z']];
export const ellipse = (cx, cy, rx, ry) => [['M', cx - rx, cy], ['A', rx, ry, 0, 1, 1, cx + rx, cy], ['A', rx, ry, 0, 1, 1, cx - rx, cy], ['Z']];
/** Polygon with rounded corners (r = number or one per vertex). */
export function roundPoly(pts, r = 0) {
  const R = Array.isArray(r) ? r : pts.map(() => r), n = pts.length, k = 0.5523, segs = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p = pts[i], p1 = pts[(i + 1) % n];
    const l0 = Math.hypot(p[0] - p0[0], p[1] - p0[1]), l1 = Math.hypot(p1[0] - p[0], p1[1] - p[1]);
    const u = [(p[0] - p0[0]) / l0, (p[1] - p0[1]) / l0], v = [(p1[0] - p[0]) / l1, (p1[1] - p[1]) / l1];
    const rr = Math.min(R[i], l0 / 2, l1 / 2);
    const a = [p[0] - u[0] * rr, p[1] - u[1] * rr], b = [p[0] + v[0] * rr, p[1] + v[1] * rr];
    segs.push([i ? 'L' : 'M', ...a]);
    if (rr) segs.push(['C', a[0] + u[0] * rr * k, a[1] + u[1] * rr * k, b[0] - v[0] * rr * k, b[1] - v[1] * rr * k, ...b]);
  }
  segs.push(['Z']);
  return segs;
}
/** Thick rounded line from p to q, width w. */
export function capsule(p, q, w) {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]), rot = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
  return place(rect(-w / 2, -w / 2, len + w, w, w / 2), { rot, x: p[0], y: p[1] });
}
/** Annular sector, angles in degrees clockwise from +x (−90 = 12 o'clock); caps 'round' | 'flat'. */
export function arcBand(cx, cy, r, w, a0, a1, caps = 'round') {
  const P = (t, a) => [cx + t * Math.cos((a * Math.PI) / 180), cy + t * Math.sin((a * Math.PI) / 180)];
  const ro = r + w / 2, ri = r - w / 2, c = w / 2, large = a1 - a0 > 180 ? 1 : 0;
  const s = [['M', ...P(ro, a0)], ['A', ro, ro, 0, large, 1, ...P(ro, a1)]];
  s.push(caps === 'round' ? ['A', c, c, 0, 0, 1, ...P(ri, a1)] : ['L', ...P(ri, a1)]);
  s.push(['A', ri, ri, 0, large, 0, ...P(ri, a0)]);
  s.push(caps === 'round' ? ['A', c, c, 0, 0, 1, ...P(ro, a0)] : ['L', ...P(ro, a0)]);
  s.push(['Z']);
  return s;
}
/** Full ring (annulus) of centre radius r and width w, as one shape (even-odd safe: inner path reversed). */
export const ring = (cx, cy, r, w) => {
  const ro = r + w / 2, ri = r - w / 2;
  return [['M', cx - ro, cy], ['A', ro, ro, 0, 1, 1, cx + ro, cy], ['A', ro, ro, 0, 1, 1, cx - ro, cy], ['Z'],
    ['M', cx - ri, cy], ['A', ri, ri, 0, 1, 0, cx + ri, cy], ['A', ri, ri, 0, 1, 0, cx - ri, cy], ['Z']];
};
/** Check mark (two capsules), `size` wide, stroke w, centred on (cx, cy). */
export const check = (cx, cy, size, w = K.wi) => {
  const a = [cx - size * 0.5, cy + size * 0.02], b = [cx - size * 0.14, cy + size * 0.36], c = [cx + size * 0.5, cy - size * 0.34];
  return [capsule(a, b, w), capsule(b, c, w)];
};
/** Euro sign as shapes (icons carry no text). */
export function euro(cx, cy, size, w = K.wi) {
  const r = size / 2 - w / 2, xc = cx + size * 0.1, bw = w * 0.8, dy = size * 0.12;
  const x0 = xc - r - w / 2 - size * 0.1, x1 = xc + size * 0.06;
  return [arcBand(xc, cy, r, w, 48, 312), rect(x0, cy - dy - bw / 2, x1 - x0, bw, bw / 2), rect(x0, cy + dy - bw / 2, x1 - x0 - size * 0.06, bw, bw / 2)];
}
/** Clock hands: minute hand to 12, hour hand to `hourDeg` (clockwise from 12), centred on (cx, cy). */
export const hands = (cx, cy, len, w = K.wi, hourDeg = 120, hourLen = 0.66) => {
  const a = ((hourDeg - 90) * Math.PI) / 180;
  return [capsule([cx, cy], [cx, cy - len], w), capsule([cx, cy], [cx + len * hourLen * Math.cos(a), cy + len * hourLen * Math.sin(a)], w)];
};
/** Apple continuous-corner rounded rectangle (iOS icon outline). */
export function contRect(x, y, w, h, r = Math.min(w, h) * LOOK.radius, smooth = LOOK.smoothing) {
  const half = Math.min(w, h) / 2;
  r = Math.min(r, half);
  const xi = Math.max(0, Math.min(smooth, half / r - 1));
  const rad = (deg) => (deg * Math.PI) / 180;
  const p = (1 + xi) * r, arc = 90 * (1 - xi);
  const L = Math.sin(rad(arc / 2)) * r * Math.SQRT2;
  const c = r * Math.tan(rad((90 - arc) / 4)) * Math.cos(rad(45 * xi));
  const d = c * Math.tan(rad(45 * xi));
  const b = (p - L - c - d) / 3, a = 2 * b;
  const corners = [[[x + w, y], [-1, 0], [0, 1]], [[x + w, y + h], [0, -1], [-1, 0]], [[x, y + h], [1, 0], [0, -1]], [[x, y], [0, 1], [1, 0]]];
  const segs = [['M', x + p, y]];
  for (const [[ox, oy], u, v] of corners) {
    const P = (A, B) => [ox + A * u[0] + B * v[0], oy + A * u[1] + B * v[1]];
    const A1 = p - a - b - c, A2 = A1 - L;
    segs.push(['L', ...P(p, 0)], ['C', ...P(p - a, 0), ...P(p - a - b, 0), ...P(A1, d)], ['A', r, r, 0, 0, 1, ...P(A2, d + L)],
      ['C', ...P(A2 - d, d + L + c), ...P(A2 - d, d + L + b + c), ...P(0, p)]);
  }
  segs.push(['Z']);
  return segs;
}

/** Points along an SVG arc segment (endpoint → centre parametrisation), for measuring. */
function arcPts(x1, y1, s, n = 24) {
  let [, rx, ry, rotDeg, fa, fs, x2, y2] = s;
  const phi = (rotDeg * Math.PI) / 180, co = Math.cos(phi), si = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = co * dx + si * dy, yp = -si * dx + co * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  let k = Math.sqrt(Math.max(0, num / (den || 1))); if (fa === fs) k = -k;
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = co * cxp - si * cyp + (x1 + x2) / 2, cy = si * cxp + co * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    out.push([cx + rx * Math.cos(t) * co - ry * Math.sin(t) * si, cy + rx * Math.cos(t) * si + ry * Math.sin(t) * co]);
  }
  return out;
}
/** Bounding box of one shape or a list of shapes: { x0, y0, x1, y1 }. */
export function bbox(d) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (x, y) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
  for (const sh of shapesOf(d)) {
    let cx = 0, cy = 0, sx = 0, sy = 0;
    for (const s of sh) {
      if (s[0] === 'M' || s[0] === 'L') { cx = s[1]; cy = s[2]; if (s[0] === 'M') { sx = cx; sy = cy; } add(cx, cy); }
      else if (s[0] === 'C') {
        const p = [[cx, cy], [s[1], s[2]], [s[3], s[4]], [s[5], s[6]]];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16, m = 1 - t, w = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t];
          add(w.reduce((a, wi, j) => a + wi * p[j][0], 0), w.reduce((a, wi, j) => a + wi * p[j][1], 0));
        }
        cx = s[5]; cy = s[6];
      } else if (s[0] === 'A') { arcPts(cx, cy, s).forEach(([x, y]) => add(x, y)); cx = s[6]; cy = s[7]; }
      else if (s[0] === 'Z') { cx = sx; cy = sy; }
    }
  }
  return b;
}

// ───────────────────────────── marks ─────────────────────────────
/** The mark library: name -> (args, K) => planes (back to front), drawn inside the live area 192..832. */
export const MARKS = {};
export const addMark = (name, fn) => { MARKS[name] = fn; return fn; };

// ───────────────────────────── render ─────────────────────────────
const planesOf = (spec) => {
  const fn = typeof spec.mark === 'function' ? spec.mark : MARKS[spec.mark];
  if (!fn) throw new Error(`unknown mark ${spec.mark}`);
  const planes = fn(spec.args || {}, K);
  const [dx, dy] = spec.nudge || [0, 0];
  if (!dx && !dy) return planes;
  if (Math.abs(dx) > 24 || Math.abs(dy) > 24) throw new Error(`${spec.id}: nudge is at most 24 units`);
  const mv = (d) => place(d, { x: dx, y: dy });
  return planes.map((p) => ({ ...p, d: mv(p.d), ...(p.cut ? { cut: mv(p.cut) } : {}) }));
};
const solidRole = (p) => p.role !== 'inlay' && p.role !== 'detail';

export function render(spec, { shape = 'squircle', size = 1024, uid = '', only, inkInlays = false } = {}) {
  const P = `${spec.id}-${shape}${uid ? `-${uid}` : ''}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const R = ramp(spec.hue), A = spec.accent ? ramp(spec.accent) : R;
  const dark = spec.tile === 'dark';
  const planes = only === 'tile' ? [] : planesOf(spec);
  const defs = [];
  const paths = (d, extra = '') => shapesOf(d).map((sh) => `<path d="${pathD(sh)}"${extra}/>`).join('');
  const gapOf = (p) => (p.gap === true ? K.gap : p.gap || 0);
  const grown = (p) => paths(p.d, ` stroke-width="${2 * gapOf(p)}" stroke-linejoin="round"`); // fill + stroke = moat

  // ── tile ──
  const tile = dark ? LOOK.tileDark : LOOK.tileLight;
  defs.push(`<linearGradient id="${P}-bg" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${tile[0]}"/><stop offset="1" stop-color="${tile[1]}"/></linearGradient>`);
  let back = `<rect width="1024" height="1024" fill="url(#${P}-bg)"/>`;
  if (dark) {
    const D = LOOK.dark;
    defs.push(`<radialGradient id="${P}-lift" cx="512" cy="-160" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="${D.lift}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
    defs.push(`<radialGradient id="${P}-bloom" cx="512" cy="560" r="540" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${R[3]}" stop-opacity="${D.bloom}"/><stop offset="0.6" stop-color="${R[3]}" stop-opacity="${D.bloom * 0.25}"/><stop offset="1" stop-color="${R[3]}" stop-opacity="0"/></radialGradient>`);
    back += `<rect width="1024" height="1024" fill="url(#${P}-lift)"/><rect width="1024" height="1024" fill="url(#${P}-bloom)"/>`;
  }

  // ── filters ──
  const F = (id, std) => `<filter id="${P}-${id}" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1424" height="1424"><feGaussianBlur stdDeviation="${std}"/></filter>`;
  defs.push(F('ov', LOOK.overlap.blur), F('gr', LOOK.ground.blur), F('gt', 3));

  // ── masks: a plane's own `cut` + the moats of the gap planes in front of it (details are cut by moats too) ──
  const maskOf = planes.map((p, i) => {
    if (p.role === 'inlay') return '';
    const knock = planes.filter((q, j) => j > i && solidRole(q) && gapOf(q));
    if (!p.cut && !knock.length) return '';
    defs.push(`<mask id="${P}-m${i}" maskUnits="userSpaceOnUse" x="-200" y="-200" width="1424" height="1424"><rect x="-200" y="-200" width="1424" height="1424" fill="#fff"/>`
      + `<g fill="#000">${p.cut ? paths(p.cut) : ''}</g><g fill="#000" stroke="#000">${knock.map(grown).join('')}</g></mask>`);
    return ` mask="url(#${P}-m${i})"`;
  });
  // a plane's silhouette with its own cut only (what it shows where nothing covers it)
  const ownCut = planes.map((p, i) => {
    if (!p.cut) return '';
    defs.push(`<mask id="${P}-k${i}" maskUnits="userSpaceOnUse" x="-200" y="-200" width="1424" height="1424"><rect x="-200" y="-200" width="1424" height="1424" fill="#fff"/><g fill="#000">${paths(p.cut)}</g></mask>`);
    return ` mask="url(#${P}-k${i})"`;
  });
  const silhouette = (p, i) => (ownCut[i] ? `<g${ownCut[i]}>${paths(p.d)}</g>` : paths(p.d));
  // what a front plane throws onto the planes behind: its silhouette, grown by its moat when it has one
  const caster = (p, i) => (gapOf(p) ? `<g stroke="currentColor">${grown(p)}</g>` : silhouette(p, i));

  // ── ground shadow of the whole mark (kept out of the moats, so they read tile-clean) ──
  const G = LOOK.ground;
  const all = planes.map((p, i) => (solidRole(p) ? `<g${maskOf[i]}>${paths(p.d)}</g>` : '')).join('');
  const gcol = dark ? '#000000' : mix(R[4], '#000000', G.darken);
  let ground = `<g filter="url(#${P}-gr)" fill="${gcol}" opacity="${dark ? 0.55 : G.op}" transform="translate(0 ${G.dy})">${all}</g>`
    + `<g filter="url(#${P}-gt)" fill="${gcol}" opacity="${dark ? 0.3 : G.tight}" transform="translate(0 3)">${all}</g>`;
  const moats = planes.map((p, j) => {
    if (!solidRole(p) || !gapOf(p)) return '';
    const behind = planes.slice(0, j).map((q, i) => (solidRole(q) ? silhouette(q, i) : '')).join('');
    if (!behind) return '';
    defs.push(`<clipPath id="${P}-b${j}">${planes.slice(0, j).map((q) => (solidRole(q) ? paths(q.d) : '')).join('')}</clipPath>`);
    return `<g clip-path="url(#${P}-b${j})" fill="#000" stroke="#000">${grown(p)}</g>`;
  }).join('');
  if (moats) {
    defs.push(`<mask id="${P}-gm" maskUnits="userSpaceOnUse" x="-200" y="-200" width="1424" height="1424"><rect x="-200" y="-200" width="1424" height="1424" fill="#fff"/>${moats}</mask>`);
    ground = `<g mask="url(#${P}-gm)">${ground}</g>`;
  }
  let art = ground;

  // ── planes ──
  planes.forEach((p, i) => {
    const H = p.hue === 'accent' || p.role === 'accent' ? A : R;
    if (p.role === 'inlay') { art += `<g fill="${inkInlays ? toneAt(H, 4) : p.color || '#FFFFFF'}"${p.opacity ? ` opacity="${p.opacity}"` : ''}>${paths(p.d)}</g>`; return; }
    if (p.role === 'detail') {
      const t = p.tone || [LOOK.detailTone, LOOK.detailTone];
      const b = bbox(p.d), gid = `${P}-g${i}`;
      defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n2(b.x0)}" y1="${n2(b.y0)}" x2="${n2(b.x0)}" y2="${n2(b.y1)}"><stop offset="0" stop-color="${toneAt(H, t[0])}"/><stop offset="1" stop-color="${toneAt(H, t[1])}"/></linearGradient>`);
      const g = `<g fill="url(#${gid})"${p.opacity ? ` opacity="${p.opacity}"` : ''}>${paths(p.d)}</g>`;
      art += maskOf[i] ? `<g${maskOf[i]}>${g}</g>` : g;
      return;
    }
    const t = p.tone || LOOK.roles[p.role] || LOOK.roles.front;
    const b = bbox(p.d), cx = (b.x0 + b.x1) / 2, h = b.y1 - b.y0, w = b.x1 - b.x0, gid = `${P}-g${i}`;
    const dx = (LOOK.axis * h) / 2;
    defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n2(cx - dx)}" y1="${n2(b.y0)}" x2="${n2(cx + dx)}" y2="${n2(b.y1)}"><stop offset="0" stop-color="${toneAt(H, t[0])}"/><stop offset="1" stop-color="${toneAt(H, t[1])}"/></linearGradient>`);
    let plane = `<g fill="url(#${gid})">${paths(p.d)}</g>`;
    const front = planes.map((q, j) => (j > i && solidRole(q) && q.cast !== false ? caster(q, j) : '')).join('');
    defs.push(`<clipPath id="${P}-c${i}">${paths(p.d)}</clipPath>`);
    if (LOOK.light > 0) {
      defs.push(`<radialGradient id="${P}-l${i}" gradientUnits="userSpaceOnUse" cx="${n2(b.x0 + w * 0.22)}" cy="${n2(b.y0 + h * 0.08)}" r="${n2(Math.max(w, h) * 0.85)}"><stop offset="0" stop-color="#fff" stop-opacity="${LOOK.light}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
      plane += `<g clip-path="url(#${P}-c${i})"><rect x="${n2(b.x0)}" y="${n2(b.y0)}" width="${n2(w)}" height="${n2(h)}" fill="url(#${P}-l${i})"/></g>`;
    }
    if (front) {
      const O = LOOK.overlap, col = mix(toneAt(H, 4), '#000000', O.darken);
      plane += `<g clip-path="url(#${P}-c${i})"><g filter="url(#${P}-ov)" fill="${col}" color="${col}" opacity="${O.op}" transform="translate(0 ${O.dy})">${front}</g></g>`;
    }
    art += maskOf[i] ? `<g${maskOf[i]}>${plane}</g>` : plane;
  });

  const sc = LOOK.scale * (shape === 'maskable' ? LOOK.maskable : 1);
  if (sc !== 1) art = `<g transform="translate(512 512) scale(${n2(sc * 10000) / 10000}) translate(-512 -512)">${art}</g>`;
  if (only === 'mark') back = '';
  let body;
  if (shape === 'full' || shape === 'maskable') body = back + art;
  else if (shape === 'squircle') {
    const sq = pathD(contRect(0, 0, 1024, 1024, 1024 * LOOK.radius));
    defs.push(`<clipPath id="${P}-sq"><path d="${sq}"/></clipPath>`);
    let edge;
    if (dark) {
      const D = LOOK.dark;
      defs.push(`<linearGradient id="${P}-ed" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="${D.edge[0]}"/><stop offset="0.3" stop-color="#fff" stop-opacity="${n2((D.edge[0] + D.edge[1]) / 3)}"/><stop offset="1" stop-color="#fff" stop-opacity="${D.edge[1]}"/></linearGradient>`);
      edge = `<path d="${sq}" fill="none" stroke="url(#${P}-ed)" stroke-width="${D.edgeW * 2}"/>`;
    } else {
      const [hc, ho, hw] = LOOK.hairLight;
      edge = `<path d="${sq}" fill="none" stroke="${hc}" stroke-opacity="${ho}" stroke-width="${hw}"/>`;
    }
    body = `<g clip-path="url(#${P}-sq)">${back}${art}${only === 'mark' ? '' : edge}</g>`;
  } else throw new Error(`unknown shape ${shape}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><defs>${defs.join('')}</defs>${body}</svg>`;
}

/** The mark's bounding box (solid planes and details), as % of the tile after LOOK.scale, plus its centre. */
export function measure(spec) {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of planesOf(spec)) {
    if (p.role === 'inlay') continue;
    const q = bbox(p.d);
    b.x0 = Math.min(b.x0, q.x0); b.y0 = Math.min(b.y0, q.y0); b.x1 = Math.max(b.x1, q.x1); b.y1 = Math.max(b.y1, q.y1);
  }
  const pc = (v) => Math.round(v * LOOK.scale / 10.24 * 10) / 10;
  const S = (v) => 512 + (v - 512) * LOOK.scale;
  return {
    id: spec.id, w: pc(b.x1 - b.x0), h: pc(b.y1 - b.y0),
    cx: Math.round(S((b.x0 + b.x1) / 2) / 10.24 * 10) / 10, cy: Math.round(S((b.y0 + b.y1) / 2) / 10.24 * 10) / 10,
    inside75: S(b.x0) >= 128 && S(b.y0) >= 128 && S(b.x1) <= 896 && S(b.y1) <= 896,
  };
}


// ═════════════════════════════ the core marks ═════════════════════════════
// Research-led (App Store top apps per category, 2026-10): each mark uses the symbol family users already read for
// that kind of app, drawn as an ORIGINAL figure in the suite's plane language. The other 26 marks are added with
// addMark in tools/icons/specs.mjs; keep new marks out of the existing ones' way (each mark's note says what it avoids).

/** Sun glyph: disc + n rays (capsules), as one shape list. */
export const sun = (cx, cy, rd, rIn, rOut, w = K.wi, n = 8, rot = 0) => {
  const out = [circle(cx, cy, rd)];
  for (let i = 0; i < n; i++) {
    const a = (((i * 360) / n + rot - 90) * Math.PI) / 180;
    out.push(capsule([cx + rIn * Math.cos(a), cy + rIn * Math.sin(a)], [cx + rOut * Math.cos(a), cy + rOut * Math.sin(a)], w));
  }
  return out;
};
/** A clock hand from (cx, cy), `deg` clockwise from 12. */
export const hand = (cx, cy, deg, len, w = K.wi) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return capsule([cx, cy], [cx + len * Math.cos(a), cy + len * Math.sin(a)], w);
};

/** Clearfigure (launcher) — the suite's "Peak" Λ: two legs (128 thick, between W and Wb so the Λ holds at 60 px) crossing in a flat apex, no crossbar, no white. The
 *  deep brand-violet leg folds over the light lavender one and casts its shadow only where it crosses.
 *  (Not Azure's ribbon A, not Agicap's white broken-leg A, not Meta Ads' white arrowhead.) */
addMark('peak', ({ top = 212, base = 800, slope = 0.38, wt = 128, rO = 36, rI = K.r } = {}) => {
  const t = wt / Math.cos(Math.atan(slope));                     // horizontal width of a wt-thick leg
  const run = (base - top) * slope, half = run + t / 2;          // both legs share the same flat apex
  const xL = 512 - half, xR = 512 + half;
  const L = [[xL, base], [xL + t, base], [xL + run + t, top], [xL + run, top]];
  const R = [[xR, base], [xR - run, top], [xR - run - t, top], [xR - t, base]];
  return [
    { role: 'back', tone: [0, 1.4], d: roundPoly(L, [rO, rI, rI, rO]) },
    { role: 'front', tone: [2.9, 4], d: roundPoly(R, [rO, rO, rI, rI]) },
  ];
});

/** Billing — an issued invoice: a receipt with a torn (zig-zag) foot and three item lines, the deep € coin in front
 *  of its lower right behind the moat; the whole torn foot stays visible. Top of the receipt one step deeper than a
 *  plain back plane so it holds on the white tile. (Not Billdu's $ scroll with an orange badge top right.) */
addMark('receiptCoin', ({ teeth = 3, depth = 60, x0 = 200, x1 = 576, y0 = 192, y1 = 820, cx = 648, cy = 560, cr = 168,
  lines = [176, 120, 144], backTone = [0.9, 1.7], detTone = 2.5 } = {}, k) => {
  const pts = [[x0, y0], [x1, y0], [x1, y1]];
  const step = (x1 - x0) / teeth;
  for (let i = 0; i < teeth; i++) pts.push([x1 - step * (i + 0.5), y1 - depth], [x1 - step * (i + 1), y1]);
  return [
    { role: 'back', tone: backTone, d: roundPoly(pts, pts.map((p, i) => (i < 2 ? k.R : 12))) },
    { role: 'detail', tone: [detTone, detTone], d: lines.map((w, i) => rect(x0 + 72, 296 + i * 88, w, k.w, k.w / 2)) },
    { role: 'front', gap: true, d: circle(cx, cy, cr) },
    { role: 'inlay', d: euro(cx - 6, cy, 168, k.wi) },
  ];
});

/** Collections — the payment alarm: a deep € coin as the body of an alarm clock (white € where the hands would be),
 *  two light bells on its shoulders and two mid feet, both tucked behind the coin's moat: "this money is due, chase it".
 *  One solid disc, no ring, nothing concentric (not a bullseye or donut chart, not Analytics' pie, not a timer).
 *  The outline (bells + feet) keeps it apart from Billing's receipt + coin. */
addMark('alarmCoin', ({ r = 262, bellR = 124, bellAt = 46, bellD = 264, footW = 88, footAt = 40, footLen = 128,
  eur = 236, bellTone = [0.5, 1.6], footTone = [1.5, 2.6], ny = 0 } = {}, k) => {
  const bell = (side) => {                                     // a dome, flat side towards the coin
    const a = -90 + side * bellAt, ar = (a * Math.PI) / 180;
    return place(halfDisc(bellR, k.r), { rot: a + 90, x: 512 + bellD * Math.cos(ar), y: 512 + bellD * Math.sin(ar) });
  };
  const foot = (side) => {
    const a = 90 - side * footAt, ar = (a * Math.PI) / 180;
    const p = [512 + (r - 40) * Math.cos(ar), 512 + (r - 40) * Math.sin(ar)];
    const q = [512 + (r - 40 + footLen) * Math.cos(ar), 512 + (r - 40 + footLen) * Math.sin(ar)];
    return capsule(p, q, footW);
  };
  const planes = [
    { role: 'back', tone: bellTone, d: [bell(-1), bell(1)] },
    { role: 'mid', tone: footTone, d: [foot(-1), foot(1)] },
    { role: 'front', gap: true, d: circle(512, 512, r) },
    { role: 'inlay', d: euro(506, 512, eur, k.wi + 4) },
  ];
  // centre the solid planes' box on the tile (then the optical offset ny)
  const B = bbox(planes.filter((p) => p.role !== 'inlay').map((p) => p.d));
  const dx = 512 - (B.x0 + B.x1) / 2, dy = 512 + ny - (B.y0 + B.y1) / 2;
  return planes.map((p) => ({ ...p, d: place(p.d, { x: dx, y: dy }) }));
});
/** Half disc of radius r, flat side on y = 0, dome towards −y; the two base corners rounded by rc. */
export function halfDisc(r, rc = K.r) {
  // corner fillet: circle of radius rc tangent to the base line (y = 0) and inside the dome
  const cx = Math.sqrt((r - rc) ** 2 - rc ** 2), cy = -rc;
  const tb = [cx, 0], ta = [cx * r / (r - rc), cy * r / (r - rc)];
  return [['M', -tb[0], 0], ['L', tb[0], 0], ['A', rc, rc, 0, 0, 0, ta[0], ta[1]], ['A', r, r, 0, 0, 0, -ta[0], ta[1]], ['A', rc, rc, 0, 0, 0, -tb[0], 0], ['Z']];
}

/** Budget vs actual — three budget envelopes (very light tracks of equal height: the budget line) with the actual
 *  column inside each; the middle period breaks out above its envelope in the deepest tone (the variance).
 *  Level tracks, never a rising staircase (not Power BI). */
addMark('envelopes', ({ acts = [0.66, 1.3, 0.45], moat = K.seam, dy = -16, envTone = [0, 0.6], midTone = [1.5, 2.8] } = {}, k) => {
  const yb = 832 + dy, top = 192 + dy, w = k.col, g = k.colGap, x0 = 512 - (3 * w + 2 * g) / 2;
  const over = Math.max(...acts), eh = (yb - top) / over, out = [];
  acts.forEach((a, i) => out.push({ role: 'back', tone: envTone, d: rect(x0 + i * (w + g), yb - eh, w, eh, k.Rb) }));
  acts.forEach((a, i) => {
    const h = eh * a;
    out.push({ role: a > 1 ? 'front' : 'mid', tone: a > 1 ? undefined : midTone, gap: moat || undefined, d: rect(x0 + i * (w + g), yb - h, w, h, k.Rb) });
  });
  return out;
});

/** Service jobs — an open-jaw wrench from lower left to upper right across a light job card: the card at the back,
 *  the amber handle on it behind its moat, the deep head with its jaw in front (deep end kept orange-amber, never
 *  brown). The card gives the thin wrench the suite's plane weight. (Not SAP FSM's blue two-tone wrench.) */
addMark('wrench', ({ H = [644, 380], hr = 180, E = [258, 766], angle = -45, jawW = 128, hw = 132, headTone = [2, 3.3], handleTone = [0.6, 1.8],
  plate, plateTone = [0, 0.7] } = {}) => {
  const u = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
  const J = [H[0] + u[0] * 36, H[1] + u[1] * 36];
  const jaw = place(rect(-jawW / 2, 0, jawW, 400, 0), { rot: angle - 90, x: J[0], y: J[1] });
  return [
    ...(plate ? [{ role: 'back', tone: plateTone, d: rect(...plate, K.R) }] : []),   // optional job-card plate behind
    { role: plate ? 'mid' : 'back', tone: handleTone, ...(plate ? { gap: true } : {}), d: capsule(H, E, hw) },
    { role: 'front', tone: headTone, gap: true, d: circle(H[0], H[1], hr), cut: [jaw, circle(J[0], J[1], jawW / 2)] },
  ];
});

/** Time & leave — the day off: a light calendar page with a flat header band and two deep binder rings, and a
 *  deep sun on the page, kept almost flat (a ray gradient turns it into a loading spinner). No day grid, no pill bar,
 *  no white sun on a plate (that reads as a gear at 60 px). */
addMark('dayOff', ({ x = 192, y = 248, w = 640, h = 560, hh = 136, rd = 84, rIn = 124, rOut = 158, rw = 48, n = 8,
  ringX = 136, body = [0, 0.5], sunTone = [3.0, 3.5] } = {}, k) => {
  const cx = x + w / 2, cy = y + hh + (h - hh) / 2;
  return [
    { role: 'back', tone: body, d: rect(x, y, w, h, k.R) },
    { role: 'mid', tone: [2.0, 2.3], d: rect(x, y, w, hh, [k.R, k.R, 0, 0]) },
    { role: 'front', tone: [3.0, 3.9], gap: 20, d: [rect(x + ringX, y - 56, 56, 120, 28), rect(x + w - ringX - 56, y - 56, 56, 120, 28)] },
    { role: 'front', tone: sunTone, d: sun(cx, cy, rd, rIn, rOut, rw, n) },
  ];
});

/** CRM — account + contact: the deep contact bust, centred in front of a light company skyline of two towers of
 *  different heights with window slits, behind the moat. One person only (not Teams' two people, not Dynamics'
 *  blue circle + quarter plane, no funnel, no linked rings). Its centred, symmetric outline keeps it apart from the
 *  "sheet + plate at the lower right" marks (Billing, Data check). */
addMark('account', ({ L = [192, 192, 216], R = [616, 304, 216], base = 760, by = 484, s = 0.96, neck = 132, nL = 2, nR = 2, lenL = 240, lenR = 170,
  slitTone = 1.6, backTone = [0, 1.0] } = {}, k) => {
  // neck: head centre → shoulder top; ≤ 136·s keeps the head and shoulder moats merged (no sliver of tower between them)
  const bust = [circle(512, by, 100 * s), roundPoly([[512 - 192 * s, 832], [512 - 192 * s, by + (neck + 98) * s], [512 - 116 * s, by + neck * s],
    [512 + 116 * s, by + neck * s], [512 + 192 * s, by + (neck + 98) * s], [512 + 192 * s, 832]], [k.R, 96 * s, 60 * s, 60 * s, 96 * s, k.R])];
  const slits = (x, w, top, n, len, sw = 36) => { const gs = (w - 80 - n * sw) / (n - 1); return Array.from({ length: n }, (_, i) => rect(x + 40 + i * (sw + gs), top + 56, sw, len, sw / 2)); };
  return [
    { role: 'back', tone: backTone, d: [rect(L[0], L[1], L[2], base - L[1], k.Rb), rect(R[0], R[1], R[2], base - R[1], k.Rb)] },
    { role: 'detail', tone: [slitTone, slitTone], d: [...slits(L[0], L[2], L[1], nL, lenL), ...slits(R[0], R[2], R[1], nR, lenR)] },
    { role: 'front', gap: true, d: bust },
  ];
});

/** Data health check — a stack of data (three elliptical slabs, lit lid on top) verified by the emerald accent
 *  check plate. No sparkles (they read as AI), no broom. */
addMark('dataCheck', ({ dx = 8 } = {}, k) => {
  const x = 200 + dx, w = 424, ry = 64, slab = 148;
  const s = (y, h) => [['M', x, y], ['A', w / 2, ry, 0, 0, 1, x + w, y], ['L', x + w, y + h], ['A', w / 2, ry, 0, 0, 1, x, y + h], ['Z']];
  const y0 = 264;
  return [
    { role: 'back', tone: [2.2, 3.6], d: s(y0 + 2 * slab, slab) },
    { role: 'mid', tone: [1.4, 2.8], d: s(y0 + slab, slab) },
    { role: 'front', tone: [0.6, 2], d: s(y0, slab) },
    { role: 'detail', tone: [0, 0.6], d: ellipse(x + w / 2, y0, w / 2, ry) },
    { role: 'accent', gap: true, d: circle(656 + dx, 656, 168) },
    { role: 'inlay', d: check(656 + dx, 660, 164, k.wi + 4) },
  ];
});
