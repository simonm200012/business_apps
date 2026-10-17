// Branded demos: what the private API (worker/demos.js) and the public Worker (public/demo.js) share. A demo is a personal
// link /d/<slug> on the public site that shows one prospect their own logo, colours, company news and a chosen set of apps.
//
//   R2 bucket LEADS (clearfigure-leads, EU), prefix demos/
//     demos/<slug>/config.json   the settings (see buildConfig)
//     demos/<slug>/logo.png      the logo, PNG only (the editor re-encodes it in the browser, so never SVG)
//     demos/<slug>/views.json    { count, last }: how often the page was opened, and when. No IP address, no cookie, no e-mail.
//
// Nothing here stores or reads a person: the prospect is only a company name the owner typed.
import CATALOG from '../site/_shared/demo-catalog.js';

export const PREFIX = 'demos/';
export const LIMITS = { name: 80, newsTitle: 120, newsText: 600, url: 300, logoBytes: 300 * 1024, bodyBytes: 480 * 1024, defaultDays: 60, maxDays: 400, cleanAfterDays: 90, maxDemos: 300 };
export const LANGS = CATALOG.LANGS;
/** App ids a demo may show: the home page's apps without the private ones (worker/access.js PRIVATE_APPS) and the Studio pages. */
export const ALLOWED_APPS = CATALOG.ids();
export const DAY = 864e5;
const SLUG = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[a-z2-7]{16}$/; // checked before any R2 key is built (keys())
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52], IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]; // first chunk after the signature; last chunk (type + CRC)
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const isSlug = (s) => typeof s === 'string' && s.length <= 64 && SLUG.test(s);
/** The R2 keys of one demo. Throws for anything that is not a slug, so no other key in the bucket can ever be built from a request. */
export const keys = (slug) => { if (!isSlug(slug)) throw new Error('not a demo slug'); return { config: PREFIX + slug + '/config.json', logo: PREFIX + slug + '/logo.png', views: PREFIX + slug + '/views.json' }; };

/** A readable part from the company name and 16 random base32 characters (80 bits: the link is the only key), e.g. "hvac-cool-k3m7qz2w4pa5bc6dxe". */
export function newSlug(name) {
  const readable = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
  const r = new Uint8Array(16); crypto.getRandomValues(r);
  const id = Array.from(r, (b) => BASE32[b & 31]).join('');
  return (readable ? readable + '-' : '') + id;
}

const line = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim() : '');
const text = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '');
const len = (s) => [...s].length;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function parseDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v + 'T23:59:59.999Z');
  return Number.isFinite(t) && day(t) === v ? t : null;
}
function httpsUrl(v) {
  const s = line(v);
  if (!s) return '';
  if (s.length > LIMITS.url) return null;
  try { const u = new URL(s); return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password ? u.href : null; } catch { return null; }
}
/** → Uint8Array of a PNG (≤ 300 KB: PNG signature, IHDR first, IEND last, as a canvas makes it) from base64 or a data: URL, or null. */
export function decodeLogo(v) {
  if (typeof v !== 'string') return null;
  const b64 = v.replace(/^data:image\/png;base64,/, '');
  if (b64.length > Math.ceil(LIMITS.logoBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  let bin;
  try { bin = atob(b64); } catch { return null; }
  if (bin.length > LIMITS.logoBytes || bin.length < 24) return null;
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const at = (sig, off) => sig.every((b, i) => bytes[off + i] === b);
  return at(PNG, 0) && at(IHDR, 12) && at(IEND, bytes.length - 8) ? bytes : null;
}

/** Checks a create (existing = null) or change (existing = the stored config) request body.
 * → { ok: true, config, logo } (logo: Uint8Array = new, null = remove, undefined = unchanged) or { ok: false, fields: [...] }.
 * Only the fields of the list below are read; everything else in the body is ignored. */
export function buildConfig(body, existing, now) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const old = existing || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const bad = [];
  const c = { v: 1, slug: old.slug, name: old.name, lang: old.lang || 'en', accent: old.accent || '#0f6cbd', accent2: old.accent2 || '', apps: old.apps || [], news: old.news || null,
    booking: old.booking || '', expires: old.expires, logo: !!old.logo, created: old.created || new Date(now).toISOString(), updated: new Date(now).toISOString() };

  if (has('name') || !existing) { const n = line(b.name); if (!n || len(n) > LIMITS.name) bad.push('name'); else c.name = n; }
  if (has('lang')) { if (LANGS.includes(b.lang)) c.lang = b.lang; else bad.push('lang'); }
  if (has('accent')) { if (typeof b.accent === 'string' && COLOUR.test(b.accent)) c.accent = b.accent.toLowerCase(); else bad.push('accent'); }
  if (has('accent2')) { if (b.accent2 === '' || b.accent2 === null) c.accent2 = ''; else if (typeof b.accent2 === 'string' && COLOUR.test(b.accent2)) c.accent2 = b.accent2.toLowerCase(); else bad.push('accent2'); }
  if (has('apps') || !existing) {
    const a = b.apps;
    if (!Array.isArray(a) || a.length < 1 || a.length > ALLOWED_APPS.length || !a.every((x) => typeof x === 'string' && ALLOWED_APPS.includes(x)) || new Set(a).size !== a.length) bad.push('apps');
    else c.apps = a.slice();
  }
  if (has('news')) {
    const n = b.news;
    if (n === null || n === '') c.news = null;
    else if (n && typeof n === 'object' && !Array.isArray(n)) {
      const title = line(n.title), tx = text(n.text);
      if (!title && !tx) c.news = null;
      else if (!title || len(title) > LIMITS.newsTitle || len(tx) > LIMITS.newsText) bad.push('news');
      else {
        const same = old.news && old.news.title === title && old.news.text === tx;
        c.news = { title, text: tx, date: same && old.news.date ? old.news.date : day(now) };
      }
    } else bad.push('news');
  }
  if (has('booking')) { const u = httpsUrl(b.booking); if (u === null) bad.push('booking'); else c.booking = u; }
  if (has('expires')) {
    const t = parseDate(b.expires);
    if (t === null || t > now + LIMITS.maxDays * DAY || (!existing && t < now)) bad.push('expires'); else c.expires = new Date(t).toISOString();
  } else if (!existing) c.expires = new Date(parseDate(day(now + LIMITS.defaultDays * DAY))).toISOString();
  if (has('expireNow') && b.expireNow === true && existing) c.expires = new Date(now - 1000).toISOString();

  let logo;
  if (has('logo')) {
    if (b.logo === null) { logo = null; c.logo = false; }
    else { const bytes = decodeLogo(b.logo); if (!bytes) bad.push('logo'); else { logo = bytes; c.logo = true; } }
  }
  if (bad.length) return { ok: false, fields: bad };
  if (!c.accent2) c.accent2 = c.accent;
  return { ok: true, config: c, logo };
}

export const isExpired = (cfg, now) => !cfg || !(Date.parse(cfg.expires) > now);

/** What the public page may know: no slug, no created/updated, no version. The apps are filtered against the allowed list again. */
export function publicConfig(cfg) {
  return { name: cfg.name, lang: cfg.lang, accent: cfg.accent, accent2: cfg.accent2 || cfg.accent, apps: (cfg.apps || []).filter((id) => ALLOWED_APPS.includes(id)),
    news: cfg.news ? { title: cfg.news.title, text: cfg.news.text, date: cfg.news.date || '' } : null, booking: cfg.booking || '', expires: cfg.expires, logo: !!cfg.logo };
}

/** Link previews and crawlers must not count as a view (and an empty user agent is not a person's browser). */
export function isBot(ua, headers) {
  const u = String(ua || '');
  if (!u || u.length < 12) return true;
  if (headers) {
    const p = String(headers.get('Purpose') || headers.get('Sec-Purpose') || headers.get('X-Purpose') || '').toLowerCase();
    if (p.includes('prefetch') || p.includes('preview')) return true;
  }
  return /bot\b|bot[\/;)-]|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|linkedin|twitter|skype|teams|outlook|mimecast|proofpoint|barracuda|safelinks|embedly|quora|pinterest|vkshare|curl\/|wget|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpclient|node-fetch|axios|postman|monitor|uptime|lighthouse|pingdom/i.test(u);
}

/** Page and API headers of a demo: private, never indexed, no referrer, strict CSP (scripts and styles only from the site itself). */
export const DEMO_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const DEMO_HEADERS = { 'Content-Security-Policy': DEMO_CSP, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' };
