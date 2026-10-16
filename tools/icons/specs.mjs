/*
 * Business Apps — the 34 icons: the "stratum" launcher and one per app on the home page (site/index.html), in its
 * order and groups. Each spec picks a colour ramp (plus an accent ramp for a status plate, and the dark tile for the
 * launcher only) and a mark. The eight core marks (peak, receiptCoin, alarmCoin, envelopes, wrench, dayOff,
 * account, dataCheck) live in kit.mjs; the other 26 are drawn below with addMark, grouped like the home page.
 * Research-led (App Store top apps per category, 2026-10): each mark uses the symbol family users already read for
 * that kind of app, drawn as an original figure in the suite's plane language; the notes above each mark say what it
 * keeps clear of. A spec's id is the app's folder in site/ and the file name in site/icons/apps/. See kit.mjs for the
 * spec format and the construction rules every mark follows; check new marks with tools/icons/build.mjs.
 */
import { addMark, rect, roundPoly, circle, ellipse, capsule, arcBand, check, euro, place, bbox, shapesOf, K } from './kit.mjs';

// ───────────────────────────── helpers (pure geometry, no new look) ─────────────────────────────
const mv = (d, o) => (d ? place(d, o) : d);
const mapPlanes = (planes, f) => planes.map((p) => ({ ...p, d: f(p.d), ...(p.cut ? { cut: f(p.cut) } : {}) }));
/** Move every plane (and its cut) by dx, dy. */
const shift = (planes, dx, dy) => mapPlanes(planes, (d) => mv(d, { x: dx, y: dy }));
const boxOf = (planes) => bbox(planes.filter((p) => p.role !== 'inlay').flatMap((p) => shapesOf(p.d)));
/** Centre the bounding box of the solid planes on the tile, then add the optical offset (nx, ny). */
const centre = (planes, nx = 0, ny = 0) => {
  const b = boxOf(planes);
  return shift(planes, 512 + nx - (b.x0 + b.x1) / 2, 512 + ny - (b.y0 + b.y1) / 2);
};
/** Centre line of a polyline whose corners are rounded by circular fillets of radius R (one R or one per corner), sampled. */
function filleted(P, R) {
  const out = [P[0]];
  const unit = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  for (let i = 1; i < P.length - 1; i++) {
    const r = Array.isArray(R) ? R[i - 1] : R;
    const u = unit(P[i - 1], P[i]), v = unit(P[i], P[i + 1]);
    const phi = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    const L = r * Math.tan(phi / 2), side = Math.sign(u[0] * v[1] - u[1] * v[0]);
    const a = [P[i][0] - u[0] * L, P[i][1] - u[1] * L];
    const c = [a[0] - side * u[1] * r, a[1] + side * u[0] * r];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), n = Math.max(8, Math.ceil(phi * 24));
    for (let j = 0; j <= n; j++) { const t = a0 + side * phi * (j / n); out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
  }
  out.push(P[P.length - 1]);
  // resample evenly (≈ 8 units) so the capsule chain is smooth
  const even = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const [p, q] = [out[i - 1], out[i]], l = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.ceil(l / 8);
    for (let j = 1; j <= m; j++) even.push([p[0] + (q[0] - p[0]) * j / m, p[1] + (q[1] - p[1]) * j / m]);
  }
  return even;
}
/** A clean thick stroke along a sampled centre line: a union of capsules (round caps and joins, never self-folding). */
function stroke(pts, w, step = 3) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i += step) out.push(capsule(pts[i], pts[Math.min(pts.length - 1, i + step)], w));
  return out;
}
/** Sheet with a folded (cut) top-right corner; returns { sheet, fold }. */
function foldedSheet(x, y, w, h, f, k = K) {
  return {
    sheet: roundPoly([[x, y], [x + w - f, y], [x + w, y + f], [x + w, y + h], [x, y + h]], [k.R, k.r, k.r, k.R, k.R]),
    fold: roundPoly([[x + w - f, y + 4], [x + w - f, y + f - 4], [x + w - 4, y + f]], [6, k.r, 6]),
  };
}

/** Vector maths. */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
const rad = (d) => (d * Math.PI) / 180;

/** Annular sector with flat ends whose four corners are filleted with radius rc (exact arcs). Angles clockwise
 *  from +x in degrees (−90 = 12 o'clock). */
function arcSeg(cx, cy, r, w, a0, a1, rc = K.r) {
  const ro = r + w / 2, ri = r - w / 2;
  const P = (t, a) => [cx + t * Math.cos(rad(a)), cy + t * Math.sin(rad(a))];
  const dO = (Math.asin(rc / (ro - rc)) * 180) / Math.PI, dI = (Math.asin(rc / (ri + rc)) * 180) / Math.PI;
  const lO = Math.sqrt((ro - rc) ** 2 - rc ** 2), lI = Math.sqrt((ri + rc) ** 2 - rc ** 2);
  const large = a1 - a0 - 2 * dO > 180 ? 1 : 0, largeI = a1 - a0 - 2 * dI > 180 ? 1 : 0;
  return [['M', ...P(ro, a0 + dO)], ['A', ro, ro, 0, large, 1, ...P(ro, a1 - dO)], ['A', rc, rc, 0, 0, 1, ...P(lO, a1)],
    ['L', ...P(lI, a1)], ['A', rc, rc, 0, 0, 1, ...P(ri, a1 - dI)], ['A', ri, ri, 0, largeI, 0, ...P(ri, a0 + dI)],
    ['A', rc, rc, 0, 0, 1, ...P(lI, a0)], ['L', ...P(lO, a0)], ['A', rc, rc, 0, 0, 1, ...P(ro, a0 + dO)], ['Z']];
}

/** Tapered capsule: a round end of radius r0 at p, a round tip of radius r1 at q, joined by the outer tangents. */
function taper(p, q, r0, r1) {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]), ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
  const phi = Math.acos((r0 - r1) / d);                              // angle of the tangent points from the axis
  const at = (c, r, a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  const A0 = at(p, r0, ang + phi), A1 = at(q, r1, ang + phi), B1 = at(q, r1, ang - phi), B0 = at(p, r0, ang - phi);
  return [['M', ...A0], ['L', ...A1], ['A', r1, r1, 0, 0, 0, ...B1], ['L', ...B0], ['A', r0, r0, 0, 1, 0, ...A0], ['Z']];
}

/** The point at distance t and angle a (degrees clockwise from +x) from (cx, cy). */
const polar = (cx, cy, t, a) => [cx + t * Math.cos(rad(a)), cy + t * Math.sin(rad(a))];

/** Pie sector from a0 to a1 (degrees clockwise from +x), radius r, every corner filleted with rc
 *  (the apex too; a reflex apex > 180° gets a concave fillet). */
function sector(cx, cy, r, a0, a1, rc = K.r) {
  const th = a1 - a0, d = (Math.asin(rc / (r - rc)) * 180) / Math.PI, q = (r - rc) * Math.cos(rad(d));
  const ta = Math.abs(th - 180) < 1e-6 ? 0 : th < 180 ? rc / Math.tan(rad(th / 2)) : rc / Math.tan(rad((360 - th) / 2));
  const sw = th < 180 ? 1 : 0, large = th - 2 * d > 180 ? 1 : 0;
  const s = [['M', ...polar(cx, cy, ta, a0)], ['L', ...polar(cx, cy, q, a0)], ['A', rc, rc, 0, 0, 1, ...polar(cx, cy, r, a0 + d)],
    ['A', r, r, 0, large, 1, ...polar(cx, cy, r, a1 - d)], ['A', rc, rc, 0, 0, 1, ...polar(cx, cy, q, a1)], ['L', ...polar(cx, cy, ta, a1)]];
  if (ta) s.push(['A', rc, rc, 0, 0, sw, ...polar(cx, cy, ta, a0)]);
  s.push(['Z']);
  return s;
}
/** Five-point star, outer radius ro, inner ri, tips rounded rt, valleys rv. */
const star = (cx, cy, ro, ri = ro * 0.47, rt = 14, rv = 6) =>
  roundPoly(Array.from({ length: 10 }, (_, i) => polar(cx, cy, i % 2 ? ri : ro, -90 + i * 36)), Array.from({ length: 10 }, (_, i) => (i % 2 ? rv : rt)));
/** Upright % glyph (two dots and a slash), `size` tall. */
const percent = (cx, cy, size, w = K.wi) => {
  const dr = size * 0.15, o = size * 0.3;
  return [circle(cx - o, cy - o, dr), circle(cx + o, cy + o, dr), capsule([cx - o * 0.95, cy + o * 1.35], [cx + o * 0.95, cy - o * 1.35], w)];
};

// ═════════════════════════════ Finance, Sales & marketing ═════════════════════════════

/** Invoices — scan frame: a light supplier sheet with a folded corner, framed (with a clear gap) by four separate,
 *  upright, deep viewfinder corners: "read automatically". Optional deep scan line across the sheet. */
addMark('scanFrame', ({ t = K.W, L = 232, ro = 2 * K.R, endR = t / 2, sheet = [352, 320, 320, 384], f = 112, bar = false } = {}, k) => {
  const x0 = 192, y0 = 192, x1 = 832, y1 = 832;
  const Lsh = roundPoly([[0, 0], [L, 0], [L, t], [t, t], [t, L], [0, L]], [ro, endR, endR, k.r, endR, endR]);
  const corners = [place(Lsh, { x: x0, y: y0 }), place(Lsh, { s: [-1, 1], x: x1, y: y0 }),
    place(Lsh, { s: [-1, -1], x: x1, y: y1 }), place(Lsh, { s: [1, -1], x: x0, y: y1 })];
  const [sx, sy, sw, sh] = sheet;
  const S = foldedSheet(sx, sy, sw, sh, f, k);
  const out = [
    { role: 'back', tone: [0.2, 1.4], d: S.sheet },
    { role: 'detail', tone: [1.9, 1.9], d: S.fold },
  ];
  if (bar) out.push({ role: 'detail', tone: [3.2, 3.2], d: rect(sx - 36, sy + sh * 0.56 - k.w / 2, sw + 72, k.w, k.w / 2) });
  out.push({ role: 'front', d: corners });
  return out;
});

/** Cash forecast — the 13-week runway as an area chart: the light cyan area under the forecast (back), a red dashed
 *  minimum-cash floor printed across it (the accent, flat), and the deep forecast line along the area's top edge in
 *  front, with sharp chart corners (centre line is a polyline; only the stroke's round joins soften it), dipping towards
 *  the floor without touching it and leaving up-right in an arrowhead. The moat round the line separates it from the
 *  area. Not a wave over a bar (that read as a signature, Contracts' idea). */
addMark('cashArea', ({ pts = [[208, 464], [352, 368], [488, 584], [624, 496], [712, 376]], base = 824, w = 96, head = [164, 200],
  floorY = 688, dash = [84, 36], floorW = 48, floorX = [232, 808], areaTone = [0.1, 1.1], fillet = 28, nx = 0, ny = 0 } = {}, k) => {
  const P = pts, n = P.length, E = P[n - 1], u = unit(sub(E, P[n - 2]));
  const tip = [E[0] + u[0] * head[0], E[1] + u[1] * head[0]], nrm = [-u[1], u[0]];
  const headD = roundPoly([[E[0] + nrm[0] * head[1] / 2, E[1] + nrm[1] * head[1] / 2], tip, [E[0] - nrm[0] * head[1] / 2, E[1] - nrm[1] * head[1] / 2]], [k.r, k.r, k.r]);
  const line = stroke(filleted(P, fillet), w, 2);
  const area = roundPoly([...P, [E[0], base], [P[0][0], base]], [k.r, ...P.slice(1, -1).map(() => 0), k.r, k.R, k.R]);
  const dashes = [];
  for (let x = floorX[0]; x + dash[0] <= floorX[1] + 1; x += dash[0] + dash[1]) dashes.push(rect(x, floorY - floorW / 2, dash[0], floorW, floorW / 2));
  return centre([
    { role: 'back', tone: areaTone, d: area },
    { role: 'detail', hue: 'accent', tone: [2.3, 2.3], d: dashes },
    { role: 'front', gap: true, d: [...line, headD] },
  ], nx, ny);
});

/** Payment reconciliation — matched, not moved: two ledger stubs side by side (the provider payout light, the bank
 *  statement mid), each with two printed rows; a deep '=' bridges the gap on the same lines, so the rows read as
 *  matched across, and the emerald accent check plate sits on the bank stub's lower right (behind its moat).
 *  Never two opposing arrows (the 'send / transfer / exchange' symbol of banking apps, Wise, Revolut). */
addMark('matchStubs', ({ card = [240, 456], cy = 448, eqW = 112, eqH = 48, eqG = 40, rowY = [-28, 60], pr = 128, pc = [712, 680], nx = -16, ny = 0 } = {}, k) => {
  const [cw, ch] = card, y0 = cy - ch / 2, xl = 192, xr = 832 - cw;
  const lines = (x) => rowY.map((dy, i) => rect(x + 48, cy + dy, (cw - 96) * [1, 0.62][i], k.w, k.w / 2));
  return centre([
    { role: 'back', tone: [0.2, 1.3], d: rect(xl, y0, cw, ch, k.R) },
    { role: 'detail', tone: [1.9, 1.9], d: lines(xl) },
    { role: 'mid', tone: [1.0, 2.2], d: rect(xr, y0, cw, ch, k.R) },
    { role: 'detail', tone: [2.8, 2.8], d: lines(xr) },
    { role: 'front', d: [rect(512 - eqW / 2, cy - eqG / 2 - eqH, eqW, eqH, eqH / 2), rect(512 - eqW / 2, cy + eqG / 2, eqW, eqH, eqH / 2)] },
    { role: 'accent', gap: true, d: circle(pc[0], pc[1], pr) },
    { role: 'inlay', d: check(pc[0], pc[1] + 4, pr * 0.92, k.wi + 4) },
  ], nx, ny);
});

/** Contracts & renewals — signed contract: a light contract sheet with a folded corner, and a deep fountain-pen nib
 *  pointing down-left across its lower-right edge, split along the slit into a mid and a deep half, white breather hole. */
addMark('signedSheet', ({ sheet = [192, 192, 384, 544], f = 120, a = 132, top = -300, sh = -20, tip = 300, slit = 24, hole = 40, holeY = -64,
  at = [656, 560], rot = 45, lone = false, nx = 0, ny = 0 } = {}, k) => {
  // half outlines in local coordinates (tip pointing to +y), x < 0 is the left half
  const yAt = (x) => sh + (1 - (-x) / a) * (tip - sh);
  const L = roundPoly([[-a, top], [-slit / 2, top], [-slit / 2, yAt(-slit / 2)], [-a, sh]], [k.Rb, k.r / 2, k.r, 2 * k.R + 24]);
  const R = place(L, { s: [-1, 1] });
  const Pn = (d) => place(d, { rot, x: at[0], y: at[1] });
  const planes = [];
  if (!lone) {
    const S = foldedSheet(...sheet, f, k);
    planes.push({ role: 'back', tone: [0.3, 1.4], d: S.sheet }, { role: 'detail', tone: [1.9, 1.9], d: S.fold });
  }
  planes.push({ role: 'mid', tone: [1.4, 2.6], gap: lone ? undefined : true, d: Pn(L) });
  planes.push({ role: 'front', tone: [2.6, 3.9], gap: lone ? undefined : true, d: Pn(R) });
  planes.push({ role: 'inlay', d: Pn(circle(0, holeY, hole)) });
  return centre(planes, nx, ny);
});

/** Clearfigure Mail — a campaign leaving the envelope: the light inside with its raised flap, a paper plane taking off out
 *  of it (its wide upper wing mid, the folded keel a step deeper) and the deep pocket with a V notch in front. The plane
 *  is the 'send a campaign' cue that keeps it from reading as the phone's own inbox (or Desk's e-mail-to-task); it is
 *  never a white plane on a disc (Telegram), never a lone plane, and the envelope has no M (Gmail). */
addMark('sendMail', ({ x = 192, w = 640, top = 584, bot = 832, apex = 424, notch = 112, plane = [540, 336], rot = -32, ps = 1.12,
  backTone = [0.2, 1.2], wingTone = [1.5, 2.7], keelTone = [2.6, 3.6], frontTone = [1.7, 3.0], ny = -24 } = {}, k) => {
  const P = (d) => place(d, { s: ps, rot, x: plane[0], y: plane[1] });
  const nose = [264, 0], tail = [-232, -104], fold = [-64, 40], foot = [-120, 176];
  return centre([
    { role: 'back', tone: backTone, d: roundPoly([[x, bot - 40], [x, top], [512, apex], [x + w, top], [x + w, bot - 40]], [k.R, k.r, k.R, k.r, k.R]) },
    { role: 'mid', tone: wingTone, gap: true, d: P(roundPoly([nose, tail, fold], [k.r, k.r, k.r])) },
    { role: 'mid', tone: keelTone, d: P(roundPoly([nose, fold, foot], [k.r, k.r, k.r])) },
    { role: 'front', tone: frontTone, d: roundPoly([[x, bot], [x, top], [512, top + notch], [x + w, top], [x + w, bot]], [k.R, k.r, 2 * k.R, k.r, k.R]) },
  ], 0, ny);
});

/** Marketing calendar — a megaphone breaking out of a small calendar sheet: the light sheet (header band, no rings) at
 *  the upper left, the megaphone flaring up-right in front of it: mid mouthpiece and bell, the deep mouth rim in front.
 *  The sheet stays small (320) so its corner is cut cleanly by the bell's moat and never pinched against the rim's. */
addMark('megaphone', ({ cal = [192, 192, 352, 352], hb = 96, rot = -20, P = [320, 676], len = 336, h0 = 72, h1 = 196, rimW = 76, piece = [104, 104],
  nx = 0, ny = 0 } = {}, k) => {
  const [cx, cy, cw, ch] = cal;
  const T = (d) => place(d, { rot, x: P[0], y: P[1] });
  const planes = [
    { role: 'back', tone: [0.2, 1.2], d: rect(cx, cy, cw, ch, k.R) },
    { role: 'detail', tone: [1.9, 2.2], d: rect(cx, cy, cw, hb, [k.R, k.R, 0, 0]) },
  ];
  if (piece) planes.push({ role: 'mid', tone: [1.2, 2.2], gap: true, d: T(rect(-piece[0], -piece[1] / 2, piece[0] + 24, piece[1], k.Rb)) });
  planes.push({ role: 'mid', gap: true, d: T(roundPoly([[0, -h0], [len, -h1], [len, h1], [0, h0]], [k.r, k.r, k.r, k.r])) });
  planes.push({ role: 'front', gap: true, d: T(rect(len - rimW / 2, -h1 - 28, rimW, 2 * h1 + 56, rimW / 2)) });
  return centre(planes, nx, ny);
});

/** Lens dome: a top arc rising h1 above the chord (cx ± hw at y = cy) and a base arc sagging h2 below it, the two
 *  tips rounded by rt (a soft contact lens seen from the front-side). */
function dome(cx, cy, hw, h1, h2, rt = K.r) {
  const R1 = (hw * hw + h1 * h1) / (2 * h1), C1 = [cx, cy - h1 + R1];
  const R2 = (hw * hw + h2 * h2) / (2 * h2), C2 = [cx, cy + h2 - R2];
  // tip fillet centre F: |F − C1| = R1 − rt, |F − C2| = R2 − rt (both centres on x = cx)
  const a = R1 - rt, b = R2 - rt, dd = C1[1] - C2[1];
  const yF = (b * b - a * a + dd * dd) / (2 * dd), xF = Math.sqrt(Math.max(0, b * b - yF * yF));
  const F = [cx + xF, C2[1] + yF], Fl = [cx - xF, C2[1] + yF];
  const on = (C, R, P) => { const l = Math.hypot(P[0] - C[0], P[1] - C[1]); return [C[0] + (P[0] - C[0]) / l * R, C[1] + (P[1] - C[1]) / l * R]; };
  const t1r = on(C1, R1, F), t1l = on(C1, R1, Fl), t2r = on(C2, R2, F), t2l = on(C2, R2, Fl);
  return [['M', ...t1l], ['A', R1, R1, 0, 0, 1, ...t1r], ['A', rt, rt, 0, 0, 1, ...t2r], ['A', R2, R2, 0, 0, 1, ...t2l], ['A', rt, rt, 0, 0, 1, ...t1l], ['Z']];
}

/** Refill & win-back — reorder loop + contact lens: one circular arrow (the ring and its built-in head in the same
 *  plane, the head's base laid over the ring's end, as Recon's arrows were built) running clockwise round a front-facing
 *  deep lens (a dome-shaped ellipse, ≈ 40 % of the ring's diameter) with a white highlight. "The customer's lenses run
 *  out: bring them back." Not a crescent (it read as a frown), not a floating head (a loading spinner). */
addMark('lensLoop', ({ r = 244, w = K.W, a0 = -48, a1 = 240, headW = 256, headLen = 172, lens = [148, 134, 46], lensY = 54, hi = [-56, -66, 42, 24], shape = 'dome', arrowTone = [0.8, 2.1], ny = 0 } = {}, k) => {
  const c = 512, ar = rad(a1), E = [c + r * Math.cos(ar), c + r * Math.sin(ar)];
  const u = [-Math.sin(ar), Math.cos(ar)], nrm = [Math.cos(ar), Math.sin(ar)];     // clockwise tangent, outward normal
  const back = 8;                                                               // base sits a little over the ring's end
  const B = [E[0] - u[0] * back, E[1] - u[1] * back];
  const head = roundPoly([[B[0] + nrm[0] * headW / 2, B[1] + nrm[1] * headW / 2], [B[0] + u[0] * headLen, B[1] + u[1] * headLen], [B[0] - nrm[0] * headW / 2, B[1] - nrm[1] * headW / 2]],
    [k.r, k.r, k.r]);
  const [rx, ry, sag] = lens, ly = c + lensY;
  return centre([
    { role: 'back', tone: arrowTone, d: [arcBand(c, c, r, w, a0, a1 - 2, 'round'), head] },
    { role: 'front', d: shape === 'dome' ? dome(c, ly, rx, ry, sag, k.r) : ellipse(c, ly, rx, ry) },
    { role: 'inlay', opacity: 0.85, d: place(ellipse(0, 0, hi[2], hi[3]), { rot: -30, x: c + hi[0], y: ly + hi[1] }) },
  ], 0, ny);
});

/** Postbench — three fanned post cards, one per platform format: a 16:9 banner at the back, a 1:1 post, and the 9:16
 *  story in front carrying the white image glyph (one rounded peak and a sun dot). Cards are big planes: K.R corners. */
addMark('fannedPosts', ({ cards = [[-12, 480, 270, [404, 330]], [-2, 360, 360, [452, 520]], [10, 288, 512, [652, 552]]], glyph = true, nx = 0, ny = 0 } = {}, k) => {
  const roles = ['back', 'mid', 'front'];
  const planes = cards.map(([rot, w, h, c], i) => ({ role: roles[i], gap: i ? true : undefined, d: place(rect(-w / 2, -h / 2, w, h, k.R), { rot, x: c[0], y: c[1] }) }));
  if (glyph) {
    const [rot, w, h, c] = cards[2];
    const g = [roundPoly([[-w * 0.32, h * 0.2], [-w * 0.04, -h * 0.06], [w * 0.32, h * 0.2]], [12, 28, 12]), circle(w * 0.16, -h * 0.2, w * 0.1)];
    planes.push({ role: 'inlay', d: place(g, { rot, x: c[0], y: c[1] }) });
  }
  return centre(planes, nx, ny);
});

// ═════════════════════════════ Operations ═════════════════════════════

/** ERP — product cube: an isometric hexagon of three rhombus faces with tile-coloured gaps between them; the top face
 *  lightest, the left face mid, the right face deepest (lit from the top left). No inlay. */
addMark('productCube', ({ R = 320, gap = K.gap, ro = 36, ri = K.r, cast = false, ny = 0 } = {}, k) => {
  const c = [512, 512];
  const V = (deg) => [c[0] + R * Math.cos((deg * Math.PI) / 180), c[1] + R * Math.sin((deg * Math.PI) / 180)];
  const T = V(-90), UR = V(-30), LR = V(30), B = V(90), LL = V(150), UL = V(210);
  // shift a face away from the centre lines by gap/2 along its own direction
  const off = (pts, dir) => pts.map((p) => [p[0] + dir[0] * gap / 2, p[1] + dir[1] * gap / 2]);
  const unit = (p) => { const l = Math.hypot(p[0], p[1]); return [p[0] / l, p[1] / l]; };
  // each face moves away from the cube centre along its own diagonal → equal gaps along the inner Y
  const fTop = off([T, UR, c, UL], [0, -1 / Math.cos(Math.PI / 6)]);
  const fL = off([UL, c, B, LL], unit([-Math.cos(Math.PI / 6), 0.5]).map((v) => v / Math.cos(Math.PI / 6)));
  const fR = off([c, UR, LR, B], unit([Math.cos(Math.PI / 6), 0.5]).map((v) => v / Math.cos(Math.PI / 6)));
  const planes = [
    { role: 'back', tone: [0.2, 1.3], d: roundPoly(fTop, [ro, ro, ri, ro]) },
    { role: 'mid', tone: [1.4, 2.6], cast, d: roundPoly(fL, [ro, ri, ro, ro]) },
    { role: 'front', tone: [2.4, 3.8], cast, d: roundPoly(fR, [ri, ro, ro, ro]) },
  ];
  return centre(planes, 0, ny);
});

/** Store daily board — a storefront (the generic 'store' glyph of maps and business profiles; retail/money green as
 *  Clover, Square, Shopify): the deep awning across the top behind a moat (top edge narrower, so it slants out; its
 *  foot runs in three shallow scallops) over the light facade with the mid-tone door and a printed window.
 *  Flat planes, no stripes, no till. (Not Google Business Profile's blue shopfront, Shopify's bag, Square's square.) */
addMark('storefront', ({ top = 200, band = 116, n = 3, sd = 60, flare = 40, face = [232, 792], faceTop = 288, foot = 832,
  door = [536, 152, 248], win = [296, 176, 168], faceTone = [0.2, 1.1], doorTone = [2.0, 3.1], winTone = [1.5, 1.5], agap = 20, dy = 0 } = {}, k) => {
  const y = (v) => v + dy, sw = 640 / n, yb = y(top + band), [dx, dw, dh] = door, [wx, ww, wh] = win;
  const awning = [roundPoly([[192 + flare, y(top)], [832 - flare, y(top)], [832, yb], [192, yb]], [k.R, k.R, 0, 0]),
    ...Array.from({ length: n }, (_, i) => ellipse(192 + sw * (i + 0.5), yb, sw / 2, sd))];
  return [
    { role: 'back', tone: faceTone, d: rect(face[0], y(faceTop), face[1] - face[0], y(foot) - y(faceTop), k.R) },
    { role: 'detail', tone: winTone, d: rect(wx, y(foot) - dh, ww, wh, k.r) },
    { role: 'mid', tone: doorTone, d: rect(dx, y(foot) - dh, dw, dh, [k.R, k.R, 0, 0]) },
    { role: 'front', gap: agap, d: awning },
  ];
});

/** Parcels & COD — a parcel on the move, front-on (the cardboard box of AfterShip, Parcel, Deliveries, in kraft
 *  orange): two light speed capsules trail off its left side; the deep box body carries the white € (cash on
 *  delivery); the lighter lid (a lit top face, the one plane allowed to be lighter in front) overhangs it behind a
 *  seam, with the tape strip printed down its middle. (Not isometric like ERP's cube, no pin, no arrow, no carrier
 *  colours.) */
addMark('parcelMove', ({ body = [392, 376, 416, 360], lid = [368, 296, 464, 128], trails = [[192, 476], [248, 596]], tw = 88, trailTo = 440,
  tape = 96, tapeTone = [0.3, 0.3], trailTone = [0.9, 2.0], lidTone = [1.0, 2.2], dy = 0 } = {}, k) => {
  const [bx, by, bw, bh] = body, [lx, ly, lw, lh] = lid, cx = bx + bw / 2;
  return [
    { role: 'back', tone: trailTone, d: trails.map(([x, yy]) => rect(x, yy + dy - tw / 2, trailTo - x, tw, tw / 2)) },
    { role: 'front', d: rect(bx, by + dy, bw, bh, k.R) },
    { role: 'mid', tone: lidTone, gap: k.seam, d: rect(lx, ly + dy, lw, lh, k.Rb) },
    { role: 'detail', tone: tapeTone, d: rect(cx - tape / 2, ly + dy, tape, lh, 0) },
    { role: 'inlay', d: euro(cx - 4, by + dy + (bh + (ly + lh - by)) / 2 + 6, 150, k.wi) },
  ];
});

/** Desk — e-mail turned into a task: the light task card with a big deep check stroke on it (the To Do / Todoist /
 *  TickTick family: a check leads), and in front at its lower right, behind the moat, the deep envelope badge with a
 *  white flap V ('this came in by e-mail'). Red like Todoist, never Mail's blue; no tray, no sheets rising out of a
 *  pocket (Mail, Pisarna). */
addMark('taskMail', ({ card = [192, 192, 488, 488], ck = [424, 432, 272], ckW = 104, env = [496, 600, 336, 232], vDepth = 0.5, cardTone = [0.2, 1.3], nx = 0, ny = 0 } = {}, k) => {
  const [x, y, w, h] = card, [ex, ey, ew, eh] = env;
  const a = [ck[0] - ck[2] * 0.5, ck[1] + ck[2] * 0.02], b = [ck[0] - ck[2] * 0.14, ck[1] + ck[2] * 0.36], c = [ck[0] + ck[2] * 0.5, ck[1] - ck[2] * 0.34];
  const m = 56, V = [[ex + m, ey + m * 0.9], [ex + ew / 2, ey + eh * vDepth + 8], [ex + ew - m, ey + m * 0.9]];
  return centre([
    { role: 'back', tone: cardTone, d: rect(x, y, w, h, k.R) },
    { role: 'front', tone: [2.0, 3.4], d: [capsule(a, b, ckW), capsule(b, c, ckW)] },
    { role: 'front', gap: true, d: rect(ex, ey, ew, eh, k.R) },
    { role: 'inlay', d: [capsule(V[0], V[1], k.wi), capsule(V[1], V[2], k.wi)] },
  ], nx, ny);
});

/** Pisarna DMS — the office binder: a lever-arch file standing upright (mid, the spine label printed light, the finger
 *  hole punched through), three light index tabs sticking out of its right edge (back), and in front at the lower
 *  right, behind the moat, the deep approval stamp (knob, neck, foot). The one folder-like app; no pocket, no sheets
 *  rising out of anything (Mail, Desk). */
addMark('binderStamp', ({ binder = [216, 200, 344, 600], tabs = [[248, 112], [384, 112]], tabW = 112, label = [104, 176], hole = 48,
  stamp = [680, 560], knob = [100, 68], neck = [96, 64], foot = [304, 104], pad = [336, 40], tabTone = [0.6, 1.6], binderTone = [1.3, 2.6], nx = 0, ny = 0 } = {}, k) => {
  const [x, y, w, h] = binder, sx = stamp[0], sy = stamp[1];
  const nk = rect(sx - neck[0] / 2, sy + knob[1] - 32, neck[0], neck[1] + 48, k.r);
  const fy = sy + knob[1] + neck[1];
  const ft = roundPoly([[sx - foot[0] / 2 + 28, fy], [sx + foot[0] / 2 - 28, fy], [sx + foot[0] / 2, fy + foot[1]], [sx - foot[0] / 2, fy + foot[1]]], [k.r, k.r, k.r, k.r]);
  const pd = rect(sx - pad[0] / 2, fy + foot[1] + 16, pad[0], pad[1], pad[1] / 2);
  return centre([
    { role: 'back', tone: tabTone, d: tabs.map(([ty, th]) => rect(x + w - 40, ty, tabW + 40, th, k.r)) },
    { role: 'mid', tone: binderTone, d: rect(x, y, w, h, k.R), cut: circle(x + w / 2, y + h - 132, hole) },
    { role: 'detail', tone: [0.3, 0.5], d: rect(x + w / 2 - label[0] / 2, y + 88, label[0], label[1], k.r) },
    { role: 'front', gap: true, d: [ellipse(sx, sy, knob[0], knob[1]), nk, ft, pd] },
  ], nx, ny);
});

/** Branch Manager — bookings per branch: two calendar pages, the second branch's page set back to the upper right
 *  (light) and the front page (mid) with its header band and a 3 × 2 grid of days printed light, one day booked in the
 *  deepest tone behind its moat. No binder rings and no sun (Time & leave), no map pin (Client Atlas), never a 2 × 2
 *  grid of squares (Microsoft's logo). */
addMark('bookedSlot', ({ page = [192, 304, 472, 488], off = [128, -80], hh = 104, grid = [3, 2], cell = [104, 104], cg = [32, 36], booked = [1, 1],
  backTone = [0.2, 1.0], pageTone = [0.6, 1.5], nx = 0, ny = 0 } = {}, k) => {
  const [x, y, w, h] = page, [cw, ch] = cell, [gx, gy] = cg;
  const gw = grid[0] * cw + (grid[0] - 1) * gx, x0 = x + (w - gw) / 2, y0 = y + hh + 48;
  const cells = [], book = [];
  for (let r = 0; r < grid[1]; r++) for (let c = 0; c < grid[0]; c++) {
    const d = rect(x0 + c * (cw + gx), y0 + r * (ch + gy), cw, ch, k.r);
    (r === booked[1] && c === booked[0] ? book : cells).push(d);
  }
  return centre([
    { role: 'back', tone: backTone, d: rect(x + off[0], y + off[1], w, h, k.R) },
    { role: 'mid', tone: pageTone, gap: true, d: rect(x, y, w, h, k.R) },
    { role: 'detail', tone: [2.6, 2.6], d: rect(x, y, w, hh, [k.R, k.R, 0, 0]) },
    { role: 'detail', tone: [0.15, 0.15], d: cells },
    { role: 'front', gap: 20, d: book },
  ], nx, ny);
});

// ═════════════════════════════ People & IT ═════════════════════════════

/** Team Tasks — cycle roadmap (engineering trackers are blue/navy; progress = steps forward + a check): three bars
 *  stepping down and to the right, longer each time (light → mid → deep), the deep one ending in its round plate
 *  behind the moat with the white check ('shipped'). (Not Jira's chevrons, Trello's board, Smartsheet's check-sheet.) */
addMark('cycleRoadmap', ({ h = K.W, g = 56, bars = [[192, 504], [272, 624], [352, 720]], pr = 128, backTone = [0.8, 1.7], dy = 0 } = {}, k) => {
  const tot = 2 * (h + g) + h / 2 + pr, y0 = 512 - tot / 2 + dy, roles = ['back', 'mid', 'front'];
  const out = bars.map(([a, b], i) => ({ role: roles[i], tone: i ? undefined : backTone, d: rect(a, y0 + i * (h + g), b - a, h, k.Rb) }));
  const pc = [832 - pr, y0 + 2 * (h + g) + h / 2];
  out.push({ role: 'front', tone: [2.6, 4], gap: true, d: circle(pc[0], pc[1], pr) });
  out.push({ role: 'inlay', d: check(pc[0], pc[1] + 4, 124, k.wi + 2) });
  return out;
});

/** Joiners & leavers — the open door (HR suites are wordmarks in warm red/coral/orange, so the pictogram is ours to
 *  own): a light doorway (rounded head, square feet) and the deep leaf swung open toward the viewer from the left
 *  jamb — its free edge taller (nearer) — overhanging the jamb behind its moat, with a white knob. No person, no
 *  arrow, not the green exit pictogram. */
addMark('openDoor', ({ way = [328, 236, 400, 568], hinge = 304, free = 480, over = 52, knob = 30, dy = 0 } = {}, k) => {
  const [wx, wy, ww, wh] = way, y = (v) => v + dy;
  return [
    { role: 'back', tone: [0.4, 1.5], d: rect(wx, y(wy), ww, wh, [k.R, k.R, 0, 0]) },
    { role: 'front', gap: true, d: roundPoly([[hinge, y(wy + 12)], [free, y(wy - over)], [free, y(wy + wh + over)], [hinge, y(wy + wh - 12)]], k.r) },
    { role: 'inlay', d: circle(free - 52, y(wy + wh / 2 + 24), knob) },
  ];
});

/** Portal usage & speed — the portal's speed gauge on its server: a 200° arc of three segments with filleted flat ends,
 *  deepening clockwise (light, mid, deep: our one-ramp take on the green → red zones), a deep tapered needle from the
 *  pivot into the deep segment, and under the dial the mid server slab (the portal) with two printed status lights.
 *  Emerald, not neutral grey (a grey gauge reads as disabled or as Settings). (Not PRTG's multicolour arc.) */
addMark('usageGauge', ({ r = 252, w = K.W + 8, sweep = 200, sg = 6, needle = -34, pivot = 56, slab = [192, 664, 640, 144], led = [[264, 56], [360, 56]],
  slabTone = [1.2, 2.4], ny = 0 } = {}, k) => {
  const cx = 512, cy = 552;
  const a0 = -90 - sweep / 2, st = sweep / 3;
  const seg = (i) => arcSeg(cx, cy, r, w, a0 + i * st + (i ? sg / 2 : 0), a0 + (i + 1) * st - (i < 2 ? sg / 2 : 0), k.r);
  const u = [Math.cos(rad(needle)), Math.sin(rad(needle))], L = r - w / 2 - 36;
  const [sx, sy, sw, sh] = slab;
  return centre([
    { role: 'back', d: seg(0) }, { role: 'mid', d: seg(1) }, { role: 'front', d: seg(2) },
    { role: 'mid', tone: slabTone, gap: true, d: rect(sx, sy, sw, sh, k.R) },
    { role: 'detail', tone: [0.2, 0.2], d: led.map(([x, d]) => circle(x, sy + sh / 2, d / 2)) },
    { role: 'front', tone: [2.8, 4], gap: true, d: [taper([cx - u[0] * 20, cy - u[1] * 20], [cx + u[0] * L, cy + u[1] * L], 44, 16), circle(cx, cy, pivot)] },
  ], 0, ny);
});

/** n8n Runs — the run board: a light board (the workflow's schedule) with a mid rail across it carrying the day's runs,
 *  two mid run dots that went fine and, overhanging the board's right edge behind the moat, the deep plate of the run the
 *  app is opened for, with a white × (failed or missed). Olive, not the automation pinks (n8n's own colour); no linked
 *  nodes or elbow connectors (n8n's, Zapier's, Make's logos); never a play plate on the rail (a media scrubber). */
addMark('runTrack', ({ board = [192, 280, 520, 464], railY = 512, railH = 56, dots = [[288, 60], [432, 60]], fail = [672, 512, 160], xs = 108,
  boardTone = [0.1, 1.0], ny = 0 } = {}, k) => {
  const [bx, by, bw, bh] = board, [fx, fy, fr] = fail;
  const x = (d) => [capsule([fx - d, fy - d], [fx + d, fy + d], K.wi + 6), capsule([fx - d, fy + d], [fx + d, fy - d], K.wi + 6)];
  return centre([
    { role: 'back', tone: boardTone, d: rect(bx, by, bw, bh, k.R) },
    { role: 'detail', tone: [1.4, 1.4], d: rect(bx + 56, railY - railH / 2, fx - bx - 56, railH, railH / 2) },
    { role: 'mid', tone: [1.8, 2.8], d: dots.map(([dx, dr]) => circle(dx, railY, dr)) },
    { role: 'front', gap: true, d: circle(fx, fy, fr) },
    { role: 'inlay', d: x(xs / 2) },
  ], 0, ny);
});

// ═════════════════════════════ Insights ═════════════════════════════

/** Analytics — a pie with a pulled slice. Light big share at the back, the mid share lying on it behind a 28-unit moat
 *  (so the slice edge stays crisp at 60 px), and the deepest quarter pulled out 56 units toward the upper right. Solid discs: never a ring
 *  (Collections, Refill, Portal usage), never bars (Budget, Power BI) or a line (Cash forecast). */
addMark('pulledPie', ({ r = 300, pull = 56, f0 = -90, f1 = 0, m1 = 112, rc = K.r, midGap = true, midTone, backTone, frontTone } = {}) => {
  const u = [Math.cos(rad((f0 + f1) / 2)), Math.sin(rad((f0 + f1) / 2))];
  // centre so that the box (pie + pulled wedge) fills the live area: the pull adds |u|·pull to the right and top
  const ex = Math.abs(u[0]) * pull, ey = Math.abs(u[1]) * pull;
  const cx = 512 - ex / 2, cy = 512 + ey / 2;
  return [
    { role: 'back', ...(backTone ? { tone: backTone } : {}), d: sector(cx, cy, r, f1, f0 + 360, rc) },
    { role: 'mid', ...(midTone ? { tone: midTone } : {}), gap: midGap || undefined, d: sector(cx, cy, r, f1, m1, rc) },
    { role: 'front', ...(frontTone ? { tone: frontTone } : {}), d: sector(cx + u[0] * pull, cy + u[1] * pull, r, f0, f1, rc) },
  ];
});

/** Ads & Return — paid click, money back: the mid € coin (white €) on the left, a light up-right return arrow leaving
 *  it towards the upper right, and the deep classic pointer in front at the lower right, its tip on the coin's edge
 *  behind the moat (spend in, revenue back: ROAS). Not broadcast arcs (a Wi-Fi cursor), not Meta's ring-arrow. */
addMark('clickReturn', ({ coin = [392, 440, 216], eur = 208, arrow = [[560, 400], [824, 208]], aw = 112, head = [176, 236], cur = [544, 520], H = 352,
  tail = 1.5, wing = 1.12, arrowTone = [0.5, 1.6], coinTone = [1.3, 2.5], nx = 0, ny = 16 } = {}, k) => {
  const [cx, cy, cr] = coin, t = tail, g = wing;
  const cursor = place(roundPoly([[0, 0], [0, 0.84 * H], [0.235 * H, 0.645 * H], [0.37 * H, 0.98 * H], [(0.37 + 0.175 * t) * H, (0.98 - 0.065 * t) * H],
    [(0.235 + 0.18 * t) * H, 0.6 * H], [0.64 * g * H, 0.6 * H]], [24, 28, 14, 28, 28, 14, 28]), { x: cur[0], y: cur[1] });
  const [P, Q] = arrow, u = unit(sub(Q, P)), nrm = [-u[1], u[0]], B = [Q[0] - u[0] * head[0], Q[1] - u[1] * head[0]];
  const shaft = capsule(P, [B[0] + u[0] * 8, B[1] + u[1] * 8], aw);
  const hd = roundPoly([[B[0] + nrm[0] * head[1] / 2, B[1] + nrm[1] * head[1] / 2], Q, [B[0] - nrm[0] * head[1] / 2, B[1] - nrm[1] * head[1] / 2]], [k.r, k.r, k.r]);
  return centre([
    { role: 'back', tone: arrowTone, d: [shaft, hd] },
    { role: 'mid', tone: coinTone, gap: true, d: circle(cx, cy, cr) },
    { role: 'inlay', d: euro(cx - 4, cy, eur, k.wi) },
    { role: 'front', gap: true, d: cursor },
  ], nx, ny);
});

/** A price tag pointing up-left (45° chamfers, so its point is a square corner), local apex at the origin. */
const tag = (tw, L, ra = 40, rs = K.r, rb = K.R) =>
  roundPoly([[0, 0], [tw / 2, tw / 2], [tw / 2, L], [-tw / 2, L], [-tw / 2, tw / 2]], [ra, rs, rb, rb, rs]);
/** Shield (pointing down), centred on (0, 0), `s` half-width. */
const shield = (s) => roundPoly([[-s, -s * 0.92], [0, -s * 1.12], [s, -s * 0.92], [s, s * 0.12], [0, s * 1.22], [-s, s * 0.12]],
  [K.r, s * 0.5, K.r, s * 1.1, s * 0.22, s * 1.1]);
/** Margin guard — the guarded price: the light price tag at 45° (its punched eyelet shows) and, in front at its lower
 *  right behind the moat, the deep shield carrying the white % (the protected margin). The shield turns the 'discount /
 *  coupon' tag into 'margin protection'. No string, no $, no second tag. */
addMark('guardTag', ({ tw = 344, L = 600, hole = 42, holeD = 140, sh = [680, 664], ss = 184, pc = 180, tagTone = [0.4, 1.6], nx = 0, ny = 0 } = {}) => {
  const pl = (d) => place(d, { rot: -45, x: 248, y: 248 });
  return centre([
    { role: 'back', tone: tagTone, d: pl(tag(tw, L)), cut: [pl(circle(0, holeD, hole))] },
    { role: 'front', gap: true, d: place(shield(ss), { x: sh[0], y: sh[1] }) },
    { role: 'inlay', d: percent(sh[0], sh[1] + 4, pc) },
  ], nx, ny);
});

/** Webshop conversion health — the leaky funnel: three bands narrowing downwards (light wide top, mid middle, deep
 *  spout) with tile gaps between them, and the drop-off: a short deep arrow escaping sideways out of the middle band
 *  behind its moat (the shoppers who leave). No handle or ring on top (it read as a kettlebell or trophy), not a plain
 *  filter triangle, no bag with a letter (Shopify, TikTok Shop). */
addMark('shopFunnel', ({ top = 200, hb = 184, g = 32, neck = 100, half = 316, spoutH = 168, drop = [[584, 472], [840, 640]], dw = 80, dh = [152, 184], rTop = K.Rb, rIn = K.r,
  tones = [[0.3, 1.5], [1.3, 2.6], [2.6, 3.9]], nx = 0, ny = 0 } = {}) => {
  const bot = 832, yN = bot - spoutH;
  const kk = (half - neck) / (yN - g - top);
  const hwAt = (y) => half - kk * (y - top);
  const band = (y0, y1, r0, r1) => roundPoly([[512 - hwAt(y0), y0], [512 + hwAt(y0), y0], [512 + hwAt(y1), y1], [512 - hwAt(y1), y1]], [r0, r0, r1, r1]);
  const y1 = top + hb, y2 = y1 + g, y3 = yN - g;
  const [P, Q] = drop, u = unit(sub(Q, P)), nrm = [-u[1], u[0]], B = [Q[0] - u[0] * dh[0], Q[1] - u[1] * dh[0]];
  const exit = [capsule(P, [B[0] + u[0] * 8, B[1] + u[1] * 8], dw),
    roundPoly([[B[0] + nrm[0] * dh[1] / 2, B[1] + nrm[1] * dh[1] / 2], Q, [B[0] - nrm[0] * dh[1] / 2, B[1] - nrm[1] * dh[1] / 2]], [K.r, K.r, K.r])];
  return centre([
    { role: 'back', tone: tones[0], d: band(top, y1, rTop, rIn) },
    { role: 'mid', tone: tones[1], d: band(y2, y3, rIn, rIn) },
    { role: 'front', tone: tones[2], d: roundPoly([[512 - neck, yN], [512 + neck, yN], [512 + neck * 0.86, bot], [512 - neck * 0.86, bot]], [rIn, rIn, K.Rb, K.Rb]) },
    { role: 'front', tone: [2.2, 3.4], gap: true, d: exit },
  ], nx, ny);
});

/** Customer service quality — the rated answer: one light speech bubble (tail at the lower left) and, in front at
 *  its lower right behind the moat, a deep round plate with a white five-point star (the quality score).
 *  One bubble only (not Tidio's pair), no headset, no check, no bolt. */
addMark('ratedAnswer', ({ bx = 192, by = 200, bw = 548, bh = 432, br = 96, tailR = 400, tip = [212, 764], joinL = 560, pr = 176, pc = [648, 648],
  so = 112, lines = 0, lineTone = 1.9 } = {}, k) => {
  const yb = by + bh;
  const pts = [[bx, by], [bx + bw, by], [bx + bw, yb], [tailR, yb], tip, [bx, joinL]];
  const out = [{ role: 'back', d: roundPoly(pts, [br, br, br, 28, k.r, 40]) }];
  if (lines) out.push({ role: 'detail', tone: [lineTone, lineTone], d: [rect(bx + 84, by + 108, 300, k.w, k.w / 2), rect(bx + 84, by + 196, 196, k.w, k.w / 2)].slice(0, lines) });
  out.push({ role: 'front', gap: true, d: circle(pc[0], pc[1], pr) });
  out.push({ role: 'inlay', d: star(pc[0], pc[1] + 8, so) });
  return out;
});

// ═════════════════════════════ Studio ═════════════════════════════

/** Clearfigure — the site's three-layer logo as planes: three slabs flush right, getting thicker towards the bottom, their
 *  left ends all cut along ONE shared slanted edge (the site logo's stepped left edge made continuous), tile-coloured
 *  gaps between them; the top slab lightest, the bottom deepest. White tile like every app in the grid. Flat, front-on:
 *  never an isometric diamond stack (Buffer), never three round pills (a menu glyph, Team Tasks). */
addMark('strata', ({ hs = [104, 144, 184], g = K.gap, x1 = 832, xTop = 368, xBot = 192, r = K.Rb, tones = [[0.2, 1.3], [1.2, 2.5], [2.3, 3.9]], ny = 0 } = {}) => {
  const total = hs.reduce((a, b) => a + b, 0) + 2 * g, y0 = 512 - total / 2 + ny;
  const xAt = (y) => xTop + (xBot - xTop) * (y - y0) / total;            // the shared slanted cut
  let y = y0;
  return hs.map((h, i) => {
    const d = roundPoly([[xAt(y), y], [x1, y], [x1, y + h], [xAt(y + h), y + h]], [r, r, r, r]);
    y += h + g;
    return { role: ['back', 'mid', 'front'][i], tone: tones[i], d };
  });
});

/** Map pin (tip filleted with a true arc): round head (r) at (cx, cy) tapering to a point at (cx, ty), tip filleted rt. */
const pinArc = (cx, cy, r, ty, rt = K.r) => {
  const D = ty - cy, phi = Math.acos(r / D), a = Math.asin(r / D);      // a = half-angle at the tip
  const Tr = [cx + r * Math.sin(phi), cy + r * Math.cos(phi)], Tl = [cx - r * Math.sin(phi), cy + r * Math.cos(phi)];
  const t = rt / Math.tan(a), L = Math.hypot(Tr[0] - cx, Tr[1] - ty);
  const along = (T) => [cx + ((T[0] - cx) * t) / L, ty + ((T[1] - ty) * t) / L];
  const fr = along(Tr), fl = along(Tl);
  return [['M', ...Tl], ['A', r, r, 0, 1, 1, ...Tr], ['L', ...fr], ['A', rt, rt, 0, 0, 1, ...fl], ['Z']];
};
/** ERP & BI Client Atlas — a folded map of three panels in a zig-zag (light left, mid centre, deeper right) and, in
 *  front behind the moat, a deep map pin over the centre panel whose head rises above the map, with a round hole.
 *  No route line (Parcels, Apple Maps), no person in the pin (CRM), not two pins (Branch Manager). */
addMark('atlasPin', ({ mt = 300, zz = 52, mb = 832, pr = 148, pcy, ptip = 676, hole = 60, tones = [[0.2, 1.1], [0.9, 1.9], [1.5, 2.5]], pinTone = [2.5, 3.95] } = {}) => {
  const xs = [192, 192 + 640 / 3, 192 + (2 * 640) / 3, 832];
  const yT = (i) => mt + (i % 2 ? 0 : zz), yB = (i) => mb - (i % 2 ? zz : 0);
  const panel = (i) => roundPoly([[xs[i], yT(i)], [xs[i + 1], yT(i + 1)], [xs[i + 1], yB(i + 1)], [xs[i], yB(i)]],
    [i === 0 ? K.Rb : 0, i === 2 ? K.Rb : 0, i === 2 ? K.Rb : 0, i === 0 ? K.Rb : 0]);
  const cy = pcy ?? 192 + pr;
  return [
    { role: 'back', tone: tones[0], d: panel(0) },
    { role: 'mid', tone: tones[1], d: panel(1) },
    { role: 'mid', tone: tones[2], d: panel(2) },
    { role: 'front', tone: pinTone, gap: true, d: pinArc(512, cy, pr, ptip), cut: circle(512, cy, hole) },
  ];
});

/** Design Comparison — pick one of three designs: three equal mini layout cards side by side (a header bar and two
 *  content blocks printed on each), the middle one raised and deep behind its moat with a white check (the pick). Rose,
 *  the design-tool family (pink/magenta), far from Analytics. No chart on any card (that read as a dashboard). */
addMark('pickOne', ({ cw = 184, ch = 376, gap = 40, lift = 80, ck = 116, cy = 540, sideTone = [0.2, 1.2], detTone = 1.9, nx = 0, ny = 0 } = {}, k) => {
  const xs = [512 - cw * 1.5 - gap, 512 - cw / 2, 512 + cw / 2 + gap], y0 = cy - ch / 2;
  const det = (x, y) => [rect(x + 28, y + 28, cw - 56, 44, 22), rect(x + 28, y + 100, (cw - 56 - 20) / 2, 120, 16), rect(x + 28 + (cw - 56 + 20) / 2, y + 100, (cw - 56 - 20) / 2, 120, 16),
    rect(x + 28, y + 248, cw - 56, 44, 22)];
  const ym = y0 - lift;
  return centre([
    { role: 'back', tone: sideTone, d: [rect(xs[0], y0, cw, ch, k.R), rect(xs[2], y0, cw, ch, k.R)] },
    { role: 'detail', tone: [detTone, detTone], d: [...det(xs[0], y0), ...det(xs[2], y0)] },
    { role: 'front', gap: true, d: rect(xs[1] - 12, ym, cw + 24, ch + 24, k.R) },
    { role: 'detail', tone: [1.2, 1.2], d: rect(xs[1] + 16, ym + 28, cw - 8, 44, 22) },
    { role: 'inlay', d: check(512, ym + 32 + ch / 2 + 32, ck, k.wi + 4) },
  ], nx, ny);
});

// ═════════════════════════════ the specs, in home-page order ═════════════════════════════
// Apps of one group never share a ramp; violet is the suite brand and belongs to the launcher only (no app ramp within
// 30° of it: indigo and plum are retired). Only the launcher has the dark tile.
export default [
  { id: 'launcher', name: 'Business Apps', group: 'Launcher', hue: 'violet', tile: 'dark', mark: 'peak' },

  { id: 'billing', name: 'Billing', group: 'Finance', hue: 'blue', mark: 'receiptCoin' },
  { id: 'invoices', name: 'Invoices', group: 'Finance', hue: 'amber', mark: 'scanFrame',
    args: { ro: 36, L: 216, sheet: [360, 332, 304, 360], f: 104 } },
  { id: 'cashflow', name: 'Cash forecast', group: 'Finance', hue: 'cyan', accent: 'crimson', mark: 'cashArea' },
  { id: 'collections', name: 'Collections', group: 'Finance', hue: 'crimson', mark: 'alarmCoin' },
  { id: 'budget', name: 'Budget vs actual', group: 'Finance', hue: 'emerald', mark: 'envelopes', args: { dy: -24 } },
  { id: 'recon', name: 'Payment reconciliation', group: 'Finance', hue: 'orange', accent: 'emerald', mark: 'matchStubs' },
  { id: 'contracts', name: 'Contracts & renewals', group: 'Finance', hue: 'ink', mark: 'signedSheet',
    args: { sheet: [192, 192, 336, 496], f: 112, a: 120, top: -248, sh: -16, tip: 272, at: [612, 604], hole: 36, holeY: -54 } },

  { id: 'crm', name: 'CRM', group: 'Sales & marketing', hue: 'berry', mark: 'account', nudge: [0, -16] },
  { id: 'mail', name: 'Clearfigure Mail', group: 'Sales & marketing', hue: 'blue', mark: 'sendMail' },
  { id: 'marketing', name: 'Marketing calendar', group: 'Sales & marketing', hue: 'coral', mark: 'megaphone',
    args: { rot: -24, P: [300, 712], h0: 72, h1: 236, len: 400, cal: [192, 192, 320, 336], hb: 92, rimW: 80, piece: [120, 128] } },
  { id: 'refill', name: 'Refill & win-back', group: 'Sales & marketing', hue: 'cyan', mark: 'lensLoop' },
  { id: 'postbench', name: 'Postbench', group: 'Sales & marketing', hue: 'magenta', mark: 'fannedPosts',
    args: { cards: [[-14, 432, 248, [392, 340]], [-2, 336, 336, [448, 508]], [10, 272, 480, [636, 552]]], nx: -16 } },

  { id: 'erp', name: 'ERP', group: 'Operations', hue: 'olive', mark: 'productCube', args: { ny: -8 } },
  { id: 'service', name: 'Service jobs', group: 'Operations', hue: 'amber', mark: 'wrench',
    args: { H: [640, 384], hr: 196, E: [264, 760], hw: 152, jawW: 136, plate: [232, 232, 480, 480], plateTone: [0.15, 1.0], handleTone: [1.0, 2.1] } },
  { id: 'stores', name: 'Store daily board', group: 'Operations', hue: 'emerald', mark: 'storefront',
    args: { band: 100, face: [280, 744], faceTop: 296, foot: 800, door: [516, 124, 224], win: [316, 148, 144], faceTone: [0, 0.75], doorTone: [1.8, 2.9], winTone: [1.1, 1.1], dy: 24 } },
  { id: 'parcels', name: 'Parcels & COD', group: 'Operations', hue: 'orange', mark: 'parcelMove', nudge: [-24, 0] },
  { id: 'branch-manager', name: 'Branch Manager', group: 'Operations', hue: 'magenta', mark: 'bookedSlot' },
  { id: 'desk', name: 'Desk', group: 'Operations', hue: 'crimson', mark: 'taskMail' },
  { id: 'pisarna-dms', name: 'Pisarna DMS', group: 'Operations', hue: 'ink', mark: 'binderStamp' },

  { id: 'leave', name: 'Time & leave', group: 'People & IT', hue: 'teal', mark: 'dayOff',
    args: { x: 224, w: 576, y: 272, h: 504, hh: 108, rd: 76, rIn: 112, rOut: 144, rw: 44, ringX: 120 } },
  { id: 'team-tasks', name: 'Team Tasks', group: 'People & IT', hue: 'blue', mark: 'cycleRoadmap', args: { h: 144, g: 48, pr: 144, bars: [[192, 560], [256, 672], [320, 720]] }, nudge: [-16, 0] },
  { id: 'onboarding', name: 'Joiners & leavers', group: 'People & IT', hue: 'orange', mark: 'openDoor' },
  { id: 'hub-usage', name: 'Portal usage & speed', group: 'People & IT', hue: 'emerald', mark: 'usageGauge' },
  { id: 'n8n', name: 'n8n Runs', group: 'People & IT', hue: 'olive', mark: 'runTrack' },

  { id: 'analytics', name: 'Analytics', group: 'Insights', hue: 'amber', mark: 'pulledPie', args: { backTone: [0.3, 1.3], midTone: [1.5, 2.6] }, nudge: [-16, 0] },
  { id: 'datacheck', name: 'Data health check', group: 'Insights', hue: 'slate', accent: 'emerald', mark: 'dataCheck', nudge: [0, -16] },
  { id: 'ads', name: 'Ads & Return', group: 'Insights', hue: 'orange', mark: 'clickReturn' },
  { id: 'margin', name: 'Margin guard', group: 'Insights', hue: 'crimson', mark: 'guardTag' },
  { id: 'webshop', name: 'Webshop conversion health', group: 'Insights', hue: 'magenta', mark: 'shopFunnel' },
  { id: 'cs-quality', name: 'Customer service quality', group: 'Insights', hue: 'teal', mark: 'ratedAnswer', args: { br: 128 } },

  { id: 'showcase', name: 'Clearfigure', group: 'Studio', hue: 'teal', mark: 'strata', nudge: [-24, -16] },
  { id: 'client-atlas', name: 'ERP & BI Client Atlas', group: 'Studio', hue: 'emerald', mark: 'atlasPin', args: { mt: 392, zz: 48 } },
  { id: 'design-compare', name: 'Design Comparison', group: 'Studio', hue: 'rose', mark: 'pickOne' },
];
