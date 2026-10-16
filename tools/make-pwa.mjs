// Makes Business Apps installable as ONE phone app ("Add to Home Screen" on iPhone, "Install" on Android and desktop):
// writes site/manifest.webmanifest and adds the home-screen tags to every page in site/, so whichever page you add,
// you get the same app that opens on the home page. The scope is "/", so moving between apps stays inside it.
// Safe to run again (the tags sit between two markers). Usage: node tools/make-pwa.mjs
// Icons: node tools/make-icons.mjs. Phone layout fixes: site/_shared/phone.css (linked by the same tags).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, 'site');
const BG = '#0C0C0D';

export const manifest = {
  name: 'Business Apps', short_name: 'Business Apps', description: 'Business apps for finance, sales, operations and people, in one place.',
  id: '/', start_url: '/', scope: '/', display: 'standalone', orientation: 'any', background_color: BG, theme_color: BG,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

const START = '<!-- phone app: tools/make-pwa.mjs -->', END = '<!-- /phone app -->';
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
// The manifest is fetched with credentials because Cloudflare Access protects every file, the manifest included.
// Status bar "black": iOS keeps the page below the clock, so no app has to make room for it; viewport-fit=cover
// lets the shell and phone.css keep pinned controls above the home indicator.
export const TAGS = START +
  '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">' +
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">' +
  '<link rel="icon" type="image/svg+xml" href="/icons/icon.svg"><link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">' +
  '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">' +
  '<meta name="apple-mobile-web-app-title" content="Business Apps"><meta name="apple-mobile-web-app-status-bar-style" content="black">' +
  '<link rel="stylesheet" href="/_shared/phone.css">' + END;

export function patchHead(html, file) {
  const viewport = /<meta\s+name=["']viewport["'][^>]*>/i;
  html = viewport.test(html) ? html.replace(viewport, VIEWPORT) : html.replace(/<head[^>]*>/i, (m) => m + '\n' + VIEWPORT);
  const block = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END);
  if (block.test(html)) return html.replace(block, TAGS);
  if (!/<\/head>/i.test(html)) throw new Error(file + ': no </head>');
  return html.replace(/<\/head>/i, TAGS + '\n</head>');
}

export function pages(dir = site) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'icons' ? [] : pages(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  fs.writeFileSync(path.join(site, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
  let n = 0;
  for (const file of pages()) {
    const html = fs.readFileSync(file, 'utf8'), out = patchHead(html, file);
    if (out !== html) { fs.writeFileSync(file, out); n++; }
  }
  console.log(`manifest written, ${n} page(s) updated`);
}
