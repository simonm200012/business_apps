// Builds the Clearfigure public site into public/dist (or --out <dir>): the landing page in SL / HR / EN, the privacy page
// and legal notice, and demo-only copies of four apps made from site/<app>/ at build time (never edited by hand).
//
//   node tools/build-public.mjs                 noindex everywhere (until Simon launches)
//   node tools/build-public.mjs --index         search engines may index the landing and legal pages
//   options: --out <dir>  --today YYYY-MM-DD (the countdown's build day)  --site-url https://www.example.si
//
// Demo copies: <meta name="stratum-public" content="1"> turns sync off and drops the "← Business Apps" link
// (site/_shared/stratum-shell.js, stratum-sync.js); /assets/demo.js adds the demo bar and /assets/demo.css hides what
// needs the private site. Google Fonts and the home-screen app tags are removed (system fonts, own favicon). The demo
// copies stay noindex even with --index: they are sample-data app screens, not pages to find in search.
// Node only, no packages.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site'), PUB = path.join(ROOT, 'public');
export const DEMO_APPS = ['collections', 'datacheck', 'cashflow', 'budget'];
export const SHARED_FILES = ['stratum-shell.js', 'stratum-sync.js', 'phone.css'];

function args(argv) {
  const o = { out: path.join(PUB, 'dist'), index: false, today: new Date().toISOString().slice(0, 10), siteUrl: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--index') o.index = true;
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--today') o.today = argv[++i];
    else if (a === '--site-url') o.siteUrl = argv[++i];
    else throw new Error('Unknown option ' + a);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.today)) throw new Error('--today must be YYYY-MM-DD');
  return o;
}

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
function copyDir(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const a = path.join(from, ent.name), b = path.join(to, ent.name);
    if (filter && !filter(a, ent)) continue;
    if (ent.isDirectory()) copyDir(a, b, filter); else fs.copyFileSync(a, b);
  }
}

/** The changes that turn a private app page into its public demo copy (exported for the tests). */
export function publicAppHtml(html, assets) {
  let h = html;
  // Google Fonts (and their preconnects) out: the apps fall back to the system fonts in their own font stacks
  h = h.replace(/[ \t]*<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*\n?/g, '');
  // the home-screen app block (manifest "Business Apps", its icons) → the Clearfigure favicon; keep the phone fixes
  h = h.replace(/<!-- phone app:[\s\S]*?<!-- \/phone app -->/, '<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"><link rel="stylesheet" href="/_shared/phone.css">');
  h = h.replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex, nofollow">');
  if (!/<meta name="robots"/.test(h)) h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow">');
  // the public switch must come before stratum-shell.js, which reads it as it loads
  if (!h.includes('<meta charset="utf-8">')) throw new Error('app page without <meta charset="utf-8">');
  h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="stratum-public" content="1">\n<script src="' + assets.demoJs + '"></script>');
  h = h.replace('</head>', '<link rel="stylesheet" href="' + assets.demoCss + '">\n</head>');
  h = h.replace(/<title>([^<]*?)\s*[—–-]\s*Business Apps<\/title>/, '<title>$1 — Clearfigure demo</title>');
  return h;
}
/** Script text in the demo copies: the private site's name in document titles and PDF metadata. */
export function publicAppJs(js) {
  return js.replace(/ — Business Apps(['"])/g, ' — Clearfigure demo$1').replace(/\(Collections, Business Apps\)/g, '(Collections, Clearfigure)')
    // Cash forecast's always-shown sentences about the private cloud copy (sync is off here). Texts that only show when
    // someone is signed in to sync never appear on the public site and are left as they are.
    .replace('Nothing is sent anywhere except your private cloud copy.', 'Nothing is sent anywhere: it all stays in this browser.')
    .replace("'It also replaces your private cloud copy, so every device you use (phone and computer) gets it too.'", "'It only changes the data in this browser.'");
}

function headersFile(o, C) {
  const ts = C.turnstileSiteKey ? ' https://challenges.cloudflare.com' : '';
  const siteCsp = "default-src 'self'; script-src 'self'" + ts + "; style-src 'self'; img-src 'self' data:; connect-src 'self'" + ts + "; frame-src" + (ts || " 'none'") + "; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self' mailto:; frame-ancestors 'none'";
  // the apps use inline styles, print windows with inline scripts, blob: downloads, and two libraries from cdnjs on demand
  const appCsp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
  const out = [];
  out.push('/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: no-referrer', '  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()', '  Cross-Origin-Opener-Policy: same-origin');
  if (!o.index) out.push('  X-Robots-Tag: noindex, nofollow');
  out.push('');
  for (const p of ['/', '/hr/*', '/en/*', '/zasebnost/*', '/pravno-obvestilo/*']) out.push(p, '  Content-Security-Policy: ' + siteCsp, '  X-Frame-Options: DENY', '');
  for (const a of DEMO_APPS) { out.push('/' + a + '/*', '  Content-Security-Policy: ' + appCsp, '  X-Frame-Options: SAMEORIGIN'); if (o.index) out.push('  X-Robots-Tag: noindex, nofollow'); out.push(''); }
  out.push('/assets/*', '  Cache-Control: public, max-age=86400', '', '/_shared/*', '  Cache-Control: no-cache', '');
  return out.join('\n');
}

export async function build(argv) {
  const o = args(argv || []);
  const out = o.out;
  // never wipe the repo, the private site or the public sources
  for (const bad of [ROOT, SITE, PUB, path.dirname(ROOT), path.join(ROOT, 'tools')]) if (path.resolve(out) === bad) throw new Error('Refusing to build into ' + out);
  if (ROOT.startsWith(path.resolve(out) + path.sep)) throw new Error('Refusing to build into a parent of the repo: ' + out);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // data and templates (fresh imports, so a second build in one process sees edits)
  const bust = '?t=' + Date.now();
  const P = (await import(pathToFileURL(path.join(PUB, 'data/prices.mjs')).href + bust)).default;
  const C = (await import(pathToFileURL(path.join(PUB, 'data/company.mjs')).href + bust)).default;
  const R = await import(pathToFileURL(path.join(PUB, 'src/render.mjs')).href);
  const { BUILT, PRODUCTS } = await import(pathToFileURL(path.join(PUB, 'src/content.mjs')).href);
  const siteUrl = (o.siteUrl || C.siteUrl || '').replace(/\/+$/, '') || '';
  if (siteUrl && !/^https:\/\/[a-z0-9.-]+$/i.test(siteUrl)) throw new Error('site URL must look like https://www.example.si');

  // assets (with a content hash in the address, so a new build is picked up at once)
  copyDir(path.join(PUB, 'assets'), path.join(out, 'assets'));
  const v = (f) => '/assets/' + f + '?v=' + hash(fs.readFileSync(path.join(PUB, 'assets', f)));
  const assets = { css: v('site.css'), js: v('site.js'), demoCss: v('demo.css'), demoJs: v('demo.js') };
  for (const id of new Set([...PRODUCTS, ...BUILT.map((b) => b[0])])) {
    const src = path.join(SITE, 'icons/apps', id + '.png');
    if (fs.existsSync(src)) { fs.mkdirSync(path.join(out, 'assets/apps'), { recursive: true }); fs.copyFileSync(src, path.join(out, 'assets/apps', id + '.png')); }
  }

  // pages
  const ctx = { P, C, today: o.today, noindex: !o.index, siteUrl, assets };
  write(path.join(out, 'index.html'), R.renderLanding({ ...ctx, lang: 'sl' }));
  write(path.join(out, 'hr/index.html'), R.renderLanding({ ...ctx, lang: 'hr' }));
  write(path.join(out, 'en/index.html'), R.renderLanding({ ...ctx, lang: 'en' }));
  write(path.join(out, 'zasebnost/index.html'), R.renderPrivacy(ctx));
  write(path.join(out, 'pravno-obvestilo/index.html'), R.renderLegal(ctx));
  write(path.join(out, '404.html'), R.render404(ctx));

  // demo copies of the four apps, made from site/<app>/ now
  for (const app of DEMO_APPS) {
    const from = path.join(SITE, app), to = path.join(out, app);
    copyDir(from, to);
    for (const f of fs.readdirSync(to)) {
      const p = path.join(to, f);
      if (f.endsWith('.html')) fs.writeFileSync(p, publicAppHtml(fs.readFileSync(p, 'utf8'), assets));
      else if (f.endsWith('.js')) fs.writeFileSync(p, publicAppJs(fs.readFileSync(p, 'utf8')));
    }
  }
  for (const f of SHARED_FILES) { fs.mkdirSync(path.join(out, '_shared'), { recursive: true }); fs.copyFileSync(path.join(SITE, '_shared', f), path.join(out, '_shared', f)); }

  // search engines
  write(path.join(out, 'robots.txt'), o.index
    ? 'User-agent: *\nAllow: /\nDisallow: /api/\n' + DEMO_APPS.map((a) => 'Disallow: /' + a + '/\n').join('') + (siteUrl ? 'Sitemap: ' + siteUrl + '/sitemap.xml\n' : '')
    : 'User-agent: *\nDisallow: /\n');
  if (o.index && siteUrl) {
    const urls = ['/', '/hr/', '/en/', '/zasebnost/', '/pravno-obvestilo/'];
    write(path.join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => '  <url><loc>' + siteUrl + u + '</loc><lastmod>' + o.today + '</lastmod></url>\n').join('') + '</urlset>\n');
  }
  write(path.join(out, '_headers'), headersFile(o, C));
  return { out, index: o.index, today: o.today, siteUrl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build(process.argv.slice(2)).then((r) => {
    console.log('Built the public site in ' + path.relative(process.cwd(), r.out) + (r.index ? ' (indexable)' : ' (noindex)') + ', build day ' + r.today + '.');
  }, (e) => { console.error(e.message || e); process.exit(1); });
}
