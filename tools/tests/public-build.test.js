// Public site build (tools/build-public.mjs): noindex by default, the public switch in the demo copies, no links into
// the private apps, no external fonts, every price and company placeholder from the data files on the page, and every
// internal link pointing at a file that exists. Builds into a temporary folder; public/dist is not touched.
// Run: node tools/tests/public-build.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const TEXT = /\.(html|js|css|txt|json|svg|xml)$|_headers$/;

(async function main() {
  const B = await import(pathToFileURL(path.join(ROOT, 'tools/build-public.mjs')).href);
  const P = (await import(pathToFileURL(path.join(ROOT, 'public/data/prices.mjs')).href)).default;
  const C = (await import(pathToFileURL(path.join(ROOT, 'public/data/company.mjs')).href)).default;
  const F = await import(pathToFileURL(path.join(ROOT, 'public/src/format.mjs')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratum-public-'));
  const out = path.join(tmp, 'dist'), outIdx = path.join(tmp, 'dist-index');
  await B.build(['--out', out, '--today', '2026-10-15']);
  await B.build(['--out', outIdx, '--today', '2026-10-15', '--index', '--site-url', 'https://www.example.si']);
  const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
  const files = walk(out);
  const texts = files.filter((f) => TEXT.test(f)).map((f) => [path.relative(out, f), fs.readFileSync(f, 'utf8')]);
  const pages = ['index.html', 'hr/index.html', 'en/index.html', 'zasebnost/index.html', 'pravno-obvestilo/index.html', '404.html'];
  const demoPages = B.DEMO_APPS.map((a) => a + '/index.html');

  await t('the build writes the three languages, the legal pages, 404, robots.txt and _headers', async () => {
    for (const p of pages.concat(demoPages, ['robots.txt', '_headers', 'assets/site.css', 'assets/site.js', 'assets/demo.js', 'assets/demo.css', 'assets/favicon.svg'])) assert.ok(fs.existsSync(path.join(out, p)), p);
    assert.match(read(out, 'index.html'), /<html lang="sl">/);
    assert.match(read(out, 'hr/index.html'), /<html lang="hr">/);
    assert.match(read(out, 'en/index.html'), /<html lang="en">/);
  });

  await t('noindex by default: every page has the robots meta, robots.txt disallows all, _headers sends X-Robots-Tag', async () => {
    for (const p of pages.concat(demoPages)) assert.match(read(out, p), /<meta name="robots" content="noindex, nofollow">/, p);
    assert.strictEqual(read(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    assert.match(read(out, '_headers'), /^\/\*\n(?:  .*\n)*  X-Robots-Tag: noindex, nofollow/m);
    assert.ok(!fs.existsSync(path.join(out, 'sitemap.xml')));
  });

  await t('--index drops noindex from the landing and legal pages (demos stay noindex) and writes robots.txt + sitemap', async () => {
    for (const p of ['index.html', 'hr/index.html', 'en/index.html', 'zasebnost/index.html', 'pravno-obvestilo/index.html']) assert.ok(!/name="robots"/.test(read(outIdx, p)), p);
    for (const p of demoPages) assert.match(read(outIdx, p), /<meta name="robots" content="noindex, nofollow">/, p);
    assert.match(read(outIdx, 'robots.txt'), /Allow: \/\n/);
    assert.match(read(outIdx, 'robots.txt'), /Sitemap: https:\/\/www\.example\.si\/sitemap\.xml/);
    assert.ok(!/^\/\*\n(?:  .*\n)*  X-Robots-Tag/m.test(read(outIdx, '_headers')), 'no site-wide X-Robots-Tag');
    assert.match(read(outIdx, 'index.html'), /<link rel="canonical" href="https:\/\/www\.example\.si\/">/);
    assert.match(read(outIdx, 'index.html'), /hreflang="hr" href="https:\/\/www\.example\.si\/hr\/"/);
    assert.match(read(outIdx, 'sitemap.xml'), /<loc>https:\/\/www\.example\.si\/en\/<\/loc>/);
    // without a site URL nothing absolute is written: works on *.workers.dev and any domain
    assert.ok(!/canonical|https:\/\/www\.example/.test(read(out, 'index.html')));
  });

  await t('demo copies: the public switch comes before stratum-shell.js, demo bar + styles injected, title renamed', async () => {
    for (const p of demoPages) {
      const h = read(out, p);
      const meta = h.indexOf('<meta name="stratum-public" content="1">'), shell = h.indexOf('/_shared/stratum-shell.js');
      assert.ok(meta > 0 && shell > meta, p + ': meta before the shell');
      assert.match(h, /<script src="\/assets\/demo\.js\?v=[0-9a-f]{10}"><\/script>/);
      assert.match(h, /<link rel="stylesheet" href="\/assets\/demo\.css\?v=[0-9a-f]{10}">\n<\/head>/);
      assert.match(h, /<title>[^<]*— Clearfigure demo<\/title>/);
      assert.ok(!/manifest\.webmanifest|apple-mobile-web-app-title|Business Apps/.test(h), p + ': no home-screen app tags or private-site name');
    }
    // the shared scripts are the repo's, byte for byte (the switch lives in them)
    for (const f of B.SHARED_FILES) assert.strictEqual(read(out, '_shared/' + f), fs.readFileSync(path.join(ROOT, 'site/_shared', f), 'utf8'), f);
    assert.match(read(out, '_shared/stratum-shell.js'), /meta\[name="stratum-public"\]/);
    assert.match(read(out, '_shared/stratum-sync.js'), /meta\[name="stratum-public"\]/);
    // only the four apps (and what they load) are copied
    const top = fs.readdirSync(out).filter((d) => fs.statSync(path.join(out, d)).isDirectory()).sort();
    assert.deepStrictEqual(top, ['_shared', 'assets', 'budget', 'cashflow', 'collections', 'datacheck', 'en', 'hr', 'pravno-obvestilo', 'zasebnost']);
    // document titles set by script say Clearfigure demo, not the private site
    for (const [f, s] of texts) if (f.endsWith('.js')) assert.ok(!/ — Business Apps['"]/.test(s), f);
  });

  await t('publicAppHtml: Google Fonts and the phone-app block out, favicon and phone fixes in', async () => {
    const h = B.publicAppHtml('<!doctype html>\n<head>\n<meta charset="utf-8">\n<script src="/_shared/stratum-shell.js"></script>\n<meta name="robots" content="noindex, nofollow">\n<title>X — Business Apps</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet">\n<!-- phone app: tools/make-pwa.mjs --><link rel="manifest" href="/manifest.webmanifest"><!-- /phone app -->\n</head>', { demoJs: '/assets/demo.js?v=1', demoCss: '/assets/demo.css?v=1' });
    assert.ok(!/fonts\.g|manifest/.test(h));
    assert.match(h, /<link rel="icon" type="image\/svg\+xml" href="\/assets\/favicon\.svg"><link rel="stylesheet" href="\/_shared\/phone\.css">/);
    assert.match(h, /<title>X — Clearfigure demo<\/title>/);
  });

  await t('no link into the private site: no private app paths, no workers.dev host, no /billing/ etc.', async () => {
    const privateApps = fs.readdirSync(path.join(ROOT, 'site'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !B.DEMO_APPS.includes(d.name)).map((d) => d.name);
    assert.ok(privateApps.includes('billing') && privateApps.includes('invoices') && privateApps.includes('client-atlas'));
    const re = new RegExp('["\'(=]/(' + privateApps.map((x) => x.replace(/[-]/g, '\\-')).join('|') + ')(/|["\'?#])');
    for (const [f, s] of texts) {
      assert.ok(!re.test(s), f + ': links to a private app: ' + (s.match(re) || [])[0]);
      assert.ok(!/business-apps\.simonm2000|simonm2000\.workers\.dev/.test(s), f + ': private host');
      if (f.endsWith('.html')) assert.ok(!/href="\/"[^>]*>[^<]*Business Apps/.test(s), f);
    }
  });

  await t('no external font URLs and no trackers anywhere in the output', async () => {
    for (const [f, s] of texts) {
      assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit|fonts\.bunny|@import url\(/.test(s), f + ': external font');
      assert.ok(!/googletagmanager|google-analytics|gtag\(|plausible\.io|hotjar|facebook\.net|clarity\.ms/.test(s), f + ': tracker');
      if (f.endsWith('.html')) assert.ok(!/document\.cookie/.test(s), f);
    }
    assert.ok(!files.some((f) => /\.(woff2?|ttf|otf)$/.test(f)));
  });

  await t('every price from prices.mjs is on the page in the language\'s format', async () => {
    const sl = read(out, 'index.html'), hr = read(out, 'hr/index.html'), en = read(out, 'en/index.html');
    const amounts = [P.datacheck.report, P.datacheck.cleanupFrom, P.datacheck.cleanupLarge, P.collections.setup, P.collections.monthly, P.collections.extraUser, P.collections.annual,
      P.cashflow.setup, P.cashflow.monthly, P.cashflow.reviewMonthly, P.bundle.setup, P.bundle.monthly, P.budget.setup, P.budget.monthly, P.budget.preparedMonthly,
      P.einvoice.connectionFrom, P.einvoice.readinessBundle, P.einvoice.readinessInsteadOf, P.einvoice.supportMonthly, P.custom.dayRate, P.custom.scoping];
    for (const a of amounts) {
      assert.ok(sl.includes(F.eur(a, 'sl')), 'sl ' + a);
      assert.ok(hr.includes(F.eur(a, 'hr')), 'hr ' + a);
      assert.ok(en.includes(F.eur(a, 'en')), 'en ' + a);
    }
    assert.strictEqual(F.eur(1234.5, 'sl'), '1.234,50\u00a0€');
    assert.strictEqual(F.eur(1490, 'en'), '€1,490');
    assert.strictEqual(F.date('2026-10-15', 'sl'), '15.\u00a010.\u00a02026');
    assert.strictEqual(F.date('2026-10-15', 'hr'), '15.\u00a010.\u00a02026.');
    assert.ok(!/draft|osnutek/i.test(sl + hr + en), 'nothing marked as draft');
    if (!P.collections.showPro) assert.ok(!/\bPro\b/.test(sl + hr + en), 'Collections Pro stays off the page while showPro is false');
  });

  await t('company details are the placeholders from company.mjs, in the footer and on the legal pages', async () => {
    for (const p of ['index.html', 'hr/index.html', 'en/index.html', 'zasebnost/index.html', 'pravno-obvestilo/index.html']) {
      const h = read(out, p);
      for (const k of ['legalName', 'address', 'registrationNumber', 'taxNumber', 'court', 'shareCapital']) assert.ok(h.includes(C[k].replace(/&/g, '&amp;')), p + ' ' + k);
      assert.ok(h.includes('mailto:' + C.email), p + ' e-mail');
    }
    const privacy = read(out, 'zasebnost/index.html');
    assert.match(privacy, /ZVOP-2/); assert.match(privacy, /Informacijsk/); assert.match(privacy, new RegExp(C.retentionMonths + ' mesecev'));
    if (!C.leadsBucketEU) assert.ok(!/jurisdikciji Evropske unije/.test(privacy), 'no EU claim until leadsBucketEU is true');
  });

  await t('the landing page: deadlines, the three steps, four products with demo links, Nordvik story, contact form', async () => {
    for (const lang of ['sl', 'hr', 'en']) {
      const h = read(out, lang === 'sl' ? 'index.html' : lang + '/index.html');
      assert.match(h, /id="einvoices"/); assert.match(h, /class="steps"/);
      for (const a of B.DEMO_APPS) assert.ok(h.includes('href="/' + a + '/?lang=' + lang + '"'), lang + ' demo ' + a);
      for (const hash of ['/cashflow/?lang=' + lang + '#/weeks', '/collections/?lang=' + lang + '#/', '/collections/?lang=' + lang + '#/promises', '/budget/?lang=' + lang + '#/comments', '/datacheck/?lang=' + lang + '#/']) assert.ok(h.includes('href="' + hash + '"'), lang + ' story ' + hash);
      assert.match(h, /<form class="card form" id="contactForm"/);
      assert.match(h, /name="website" tabindex="-1"/, 'honeypot');
      assert.match(h, /aria-current="true"[^>]*>|<a href="[^"]*" hreflang="[a-z]{2}" lang="[a-z]{2}" aria-current="true"/);
      const json = h.match(/<script type="application\/json" id="siteText">([\s\S]*?)<\/script>/);
      const T = JSON.parse(json[1]);
      assert.strictEqual(T.lang, lang); assert.ok(T.msg.ok && T.msg.fail && T.msg.rate);
      assert.ok(!/<(?!\/?(b|span|a|br)\b)[a-z]/i.test(T.msg.ok));
      assert.ok(!/\bDraft\b/.test(h));
    }
    assert.match(read(out, 'index.html'), /še 443 dni/, 'days until 1. 1. 2028 on the build day');
  });

  await t('every internal link on the pages points at a file in the build', async () => {
    for (const p of pages) {
      const h = read(out, p);
      for (const m of h.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
        const u = m[1].split(/[?#]/)[0];
        const f = path.join(out, u.endsWith('/') ? u + 'index.html' : u);
        assert.ok(fs.existsSync(f), p + ' → ' + m[1]);
      }
    }
  });

  await t('_headers: strict CSP on the site pages, app CSP on the demos, no CSP header twice on one path', async () => {
    const hd = read(out, '_headers');
    assert.match(hd, /\n\/\n  Content-Security-Policy: default-src 'self'; script-src 'self';/);
    for (const a of B.DEMO_APPS) assert.match(hd, new RegExp('\\n/' + a + "/\\*\\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs\\.cloudflare\\.com"));
    const star = hd.split('\n\n').find((b) => b.startsWith('/*\n'));
    assert.ok(!/Content-Security-Policy/.test(star), 'no site-wide CSP that would combine with the per-path ones');
  });

  await t('refuses to build into the repo, site/ or public/', async () => {
    for (const bad of [ROOT, path.join(ROOT, 'site'), path.join(ROOT, 'public')]) await assert.rejects(() => B.build(['--out', bad]), /Refusing/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('all ' + n + ' public build tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
