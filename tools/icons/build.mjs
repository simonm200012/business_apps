// Business Apps — Fluent suite icon check: a contact sheet and a measurement of every mark, for drawing new marks.
// The icons the site uses are written by tools/make-icons.mjs; this script writes nothing into site/.
//
//   SHARP_FROM=<a package.json with sharp> node tools/icons/build.mjs tools/icons/specs.mjs <outdir> [--full] [--maskable]
//
//   <specs.mjs> exports default an array of specs (see kit.mjs). It may also import kit.mjs and addMark() its
//   own marks before exporting (tools/icons/specs.mjs does).
//   <outdir>/<id>.png    squircle icon, 512 px (drawn at 2048 = 4× and scaled down with lanczos3)
//   <outdir>/sheet.png   every icon at 180 px with its name, then all of them at 60 px on a light and on a dark
//                        wallpaper strip (iPhone home-screen spacing)
//   --full / --maskable  also write <id>-full.png / <id>-maskable.png (512 px)
//
// It prints, per icon, the mark's bounding box (% of the tile), the raster ink coverage, the optical centre (ink
// centroid weighted by how far each pixel is from the tile colour) and the median hue of the mark's coloured pixels,
// and warns when a mark leaves the central 75 %, is far from the ≈ 66 % size band, sits off-centre, carries too little
// or too much ink for the family (coverage outside 22–32 %: thin stroke marks look like an outline set next to the
// solid slab marks), or comes within 30° of the brand violet that only the launcher may own.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { render, measure, RAMPS } from './kit.mjs';

const sharp = createRequire(process.env.SHARP_FROM || import.meta.url)('sharp');
const args = process.argv.slice(2);
const [specFile, outDir] = args.filter((a) => !a.startsWith('--'));
if (!specFile || !outDir) { console.error('usage: node tools/icons/build.mjs <specs.mjs> <outdir> [--full] [--maskable]'); process.exit(1); }
const specs = (await import(pathToFileURL(path.resolve(specFile)).href)).default;
fs.mkdirSync(outDir, { recursive: true });

/** The icon drawn once at 4 × 512 = 2048 px; every size is scaled down from it with lanczos3 (as iOS does). */
const masters = new Map();
const master = async (spec, shape = 'squircle') => {
  const key = `${spec.id}|${shape}`;
  if (!masters.has(key)) masters.set(key, await sharp(Buffer.from(render(spec, { shape, size: 2048 }))).png().toBuffer());
  return masters.get(key);
};
const png = async (spec, px, shape = 'squircle') => sharp(await master(spec, shape)).resize(px, px, { kernel: 'lanczos3' }).png().toBuffer();

/** Hue (0–360) and saturation (0–1) of an RGB pixel. */
const hsv = (r, g, b) => {
  const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
  let h = 0;
  if (d) h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, M ? d / M : 0];
};
/** Median of hues on the circle: unwrap round the circular mean, take the median, wrap back. */
const hueMedian = (hs) => {
  if (!hs.length) return null;
  const sx = hs.reduce((a, h) => a + Math.cos((h * Math.PI) / 180), 0), sy = hs.reduce((a, h) => a + Math.sin((h * Math.PI) / 180), 0);
  const mean = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const un = hs.map((h) => ((h - mean + 540) % 360) - 180).sort((a, b) => a - b);
  return Math.round((un[un.length >> 1] + mean + 360) % 360);
};
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const BRAND = (() => { const h = RAMPS.violet[2].replace('#', ''); return hsv(...[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)))[0]; })();

/** Raster check: ink bounding box, coverage and centroid of the mark (difference against the empty tile; white inlays
 *  are drawn in the deep tone for this, so a € or check on a plate counts as ink), and the median hue of its coloured
 *  pixels (saturation ≥ 0.25). */
async function optical(spec) {
  const N = 256;
  const raw = (o) => sharp(Buffer.from(render(spec, { shape: 'full', size: N, ...o }))).raw().toBuffer({ resolveWithObject: true });
  const [a, b] = await Promise.all([raw({ inkInlays: true }), raw({ only: 'tile' })]);
  const C = a.info.channels;
  let x0 = N, y0 = N, x1 = -1, y1 = -1, area = 0, sx = 0, sy = 0, sw = 0;
  const hues = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * C;
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 90) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); area++; sx += x * d; sy += y * d; sw += d;
      const [h, sat] = hsv(a.data[i], a.data[i + 1], a.data[i + 2]);
      if (sat >= 0.25) hues.push(h);
    }
  }
  const pc = (v) => Math.round((v / N) * 1000) / 10;
  return { w: pc(x1 - x0 + 1), h: pc(y1 - y0 + 1), ink: Math.round((area / (N * N)) * 1000) / 10, ox: pc(sx / sw + 0.5), oy: pc(sy / sw + 0.5),   // tone-weighted: deep planes weigh more than pale ones
    hue: hueMedian(hues) };
}

for (const s of specs) {
  fs.writeFileSync(path.join(outDir, `${s.id}.png`), await png(s, 512));
  if (args.includes('--full')) fs.writeFileSync(path.join(outDir, `${s.id}-full.png`), await png(s, 512, 'full'));
  if (args.includes('--maskable')) fs.writeFileSync(path.join(outDir, `${s.id}-maskable.png`), await png(s, 512, 'maskable'));
  const m = measure(s), o = await optical(s), big = Math.max(o.w, o.h);
  // box centre within ±2.5 % of the tile centre (optical nudges ≤ 24 units). The tone-weighted ink centre may drift further:
  // ±5 % across, and 47–57 % down (the shared top-left light makes every plane deeper at its foot, so a centred mark
  // measures ≈ 2–4 % low)
  // ink coverage (share of the tile the mark covers, 256 px): one family weight, 22–32 %. The launcher is exempt (it is
  // the brand, not an app), and so is the hue check, which keeps every app ≥ 30° away from the brand violet.
  const app = s.hue !== 'violet';
  const warn = [!m.inside75 && 'leaves the central 75 %', (big < 56 || big > 70) && 'size off the 56–70 % band',
    (Math.abs(m.cx - 50) > 2.5 || Math.abs(m.cy - 50) > 2.5) && 'box off-centre',
    (Math.abs(o.ox - 50) > 5 || o.oy < 47 || o.oy > 57) && 'ink centre off',
    app && (o.ink < 22 || o.ink > 32) && 'ink coverage off the 22–32 % band',
    app && o.hue !== null && hueGap(o.hue, BRAND) < 30 && `hue ${o.hue}° within 30° of the brand violet (${Math.round(BRAND)}°)`].filter(Boolean).join(', ');
  console.log(`${s.id.padEnd(16)} box ${String(m.w).padStart(4)} × ${String(m.h).padStart(4)} % at ${m.cx}, ${m.cy}  ink ${String(o.w).padStart(4)} × ${String(o.h).padStart(4)} %  `
    + `cover ${String(o.ink).padStart(4)} %  ink-centre ${o.ox}, ${o.oy}  hue ${String(o.hue ?? '–').padStart(3)}°${warn ? '   ! ' + warn : ''}`);
}

// ── contact sheet ──
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const font = `font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"`;
const BIG = 180, BGAP = 44, BCOLS = Math.min(specs.length, 8), PAD = 56;
const IC = 60, PITCH = 87, ROW = 104, SCOLS = Math.min(specs.length, 12);
const bigW = BCOLS * BIG + (BCOLS - 1) * BGAP, stripW = (SCOLS - 1) * PITCH + IC + 2 * 70;
const W = Math.max(bigW, stripW) + 2 * PAD;
const parts = [], comps = [];
let y = 44;
parts.push(`<text x="${PAD}" y="${y}" ${font} font-size="22" font-weight="600" fill="#1d1d1f">Business Apps — Fluent suite icons</text>`);
y += 30;
const bx0 = (W - bigW) / 2;
for (const [i, s] of specs.entries()) {
  const c = i % BCOLS, r = Math.floor(i / BCOLS);
  const x = Math.round(bx0 + c * (BIG + BGAP)), yy = Math.round(y + r * (BIG + 64));
  comps.push({ input: await png(s, BIG), left: x, top: yy });
  parts.push(`<text x="${x + BIG / 2}" y="${yy + BIG + 30}" text-anchor="middle" ${font} font-size="17" fill="#3a3a3c">${esc(s.name)}</text>`);
}
y += Math.ceil(specs.length / BCOLS) * (BIG + 64) + 10;
const strip = async (uid, dark) => {
  const rows = Math.ceil(specs.length / SCOLS), H = rows * ROW + 46;
  parts.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${H}" rx="30" fill="url(#wall${uid})"/>`);
  parts.push(`<text x="${PAD + 22}" y="${y + 24}" ${font} font-size="12" font-weight="600" fill="${dark ? '#9a9aae' : '#6b6b78'}">60 px · ${dark ? 'dark' : 'light'} wallpaper</text>`);
  const x0 = (W - ((SCOLS - 1) * PITCH + IC)) / 2;
  for (const [i, s] of specs.entries()) {
    const c = i % SCOLS, r = Math.floor(i / SCOLS), x = Math.round(x0 + c * PITCH), yy = Math.round(y + 32 + r * ROW);
    comps.push({ input: await png(s, IC), left: x, top: yy });
    const label = s.name.length > 13 ? s.name.slice(0, 12).trimEnd() + '…' : s.name;
    parts.push(`<text x="${x + IC / 2}" y="${yy + IC + 16}" text-anchor="middle" ${font} font-size="11.5" font-weight="500" fill="${dark ? '#ffffff' : '#1d1d1f'}" fill-opacity="${dark ? 0.92 : 0.86}">${esc(label)}</text>`);
  }
  y += H + 22;
};
await strip('L', false);
await strip('D', true);
y += 10;
const walls = `<linearGradient id="wallL" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ECE9F4"/><stop offset="0.5" stop-color="#E3E9F2"/><stop offset="1" stop-color="#D5E3EC"/></linearGradient>`
  + `<linearGradient id="wallD" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121318"/><stop offset="1" stop-color="#242436"/></linearGradient>`;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}"><defs>${walls}</defs><rect width="${W}" height="${y}" fill="#F5F5F7"/>${parts.join('')}</svg>`;
await sharp(Buffer.from(sheet)).composite(comps).png().toFile(path.join(outDir, 'sheet.png'));
console.log(`sheet ${W}×${y} → ${path.join(outDir, 'sheet.png')}`);
