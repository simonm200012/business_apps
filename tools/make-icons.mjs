// Makes every Business Apps icon (run after changing tools/icons/; the PNGs are committed). The art is drawn in
// tools/icons/kit.mjs (construction rules, colour ramps, rendering, the core marks) and tools/icons/specs.mjs (one spec
// per app, in home-page order, and the other marks); tools/icons/build.mjs checks new marks on a contact sheet.
//   site/icons/apple-touch-icon.png, icon-192.png, icon-512.png   the "stratum" launcher, full-bleed square, opaque
//                                                                 (iOS and Android cut the corners themselves)
//   site/icons/icon-maskable-512.png                              the same with the symbol inside Android's safe zone
//   site/icons/icon.svg                                           the favicon, already squircle-shaped
//   site/icons/apps/<id>.png                                      192 × 192, squircle with transparent corners, one per
//                                                                 app (id = its folder in site/) plus stratum.png; the
//                                                                 home page and the showcase show them
// The manifest and every page's tags (tools/make-pwa.mjs) point at these names.
// Needs "sharp": npm i --no-save sharp, or SHARP_FROM=/path/to/a/project/package.json node tools/make-icons.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { render } from './icons/kit.mjs';
import specs from './icons/specs.mjs';

const require = createRequire(process.env.SHARP_FROM || import.meta.url);
const sharp = require('sharp');
const out = path.resolve(import.meta.dirname, '../site/icons');
const launcher = specs.find((s) => s.id === 'launcher');

// Drawn at 4× and scaled down: smoother edges and blurs than librsvg gives at the final size.
async function png(spec, shape, size, file, opaque = false) {
  let img = sharp(Buffer.from(render(spec, { shape, size: size * 4 }))).resize(size, size, { kernel: 'lanczos3' });
  if (opaque) img = img.flatten({ background: '#0C0C0D' });
  await img.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(path.join(out, file));
}

await fs.mkdir(path.join(out, 'apps'), { recursive: true });
await png(launcher, 'full', 180, 'apple-touch-icon.png', true);
await png(launcher, 'full', 192, 'icon-192.png', true);
await png(launcher, 'full', 512, 'icon-512.png', true);
await png(launcher, 'maskable', 512, 'icon-maskable-512.png', true);
await fs.writeFile(path.join(out, 'icon.svg'), render(launcher, { shape: 'squircle', size: 48 }));
for (const s of specs) await png(s, 'squircle', 192, `apps/${s.id}.png`);
console.log(`icons → site/icons (launcher) and site/icons/apps (${specs.length})`);
