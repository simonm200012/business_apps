// Client portal: keys, small helpers and the audit log, shared by the staff Worker (worker/portal-staff.js) and the portal
// Worker (worker/portal.js). Bucket layout (business-apps-portal-eu, binding PORTAL; no e-mail addresses in any key):
//   p/<t>/c/<c>/meta.json · view.json · files/<fid> · responses/<quoteId>.json · users/<emailHash>.json
//   p/<t>/brand.json · p/<t>/brand/logo · p/<t>/news.json · p/<t>/audit/<yyyy-mm-dd>/<hhmmssSSS>-<rand>.json
//   pu/<sha256('cf-portal:' + e-mail)>.json → { t, c, addedAt, addedBy, disabled }   one e-mail → one client
// t = tenant (first 32 hex of the staff person's userPrefix hash), c = random 128-bit hex made when staff enable a client.
import { sha256hex, HEX32, HEX64 } from './portal-schema.js';

export const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };
export const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...extra } });

/** The tenant id of a staff e-mail: the same 32 hex characters as the staff apps' u/<hash>/ folder. */
export const tenantOf = async (email) => (await sha256hex('stratum-apps:' + email)).slice(0, 32);
export const emailHash = (email) => sha256hex('cf-portal:' + String(email).trim().toLowerCase());
export const userKey = async (email) => 'pu/' + (await emailHash(email)) + '.json';
export const cPrefix = (t, c) => 'p/' + t + '/c/' + c + '/';
export const K = {
  meta: (t, c) => cPrefix(t, c) + 'meta.json', view: (t, c) => cPrefix(t, c) + 'view.json', file: (t, c, f) => cPrefix(t, c) + 'files/' + f,
  response: (t, c, q) => cPrefix(t, c) + 'responses/' + q + '.json', marker: (t, c, h) => cPrefix(t, c) + 'users/' + h + '.json',
  brand: (t) => 'p/' + t + '/brand.json', logo: (t) => 'p/' + t + '/brand/logo', news: (t) => 'p/' + t + '/news.json',
};
export const randHex = (bytes = 8) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
/** "Now": real clock, unless a test put a function in env.__now (a Worker binding can never be a function). */
export const nowDate = (env) => (env && typeof env.__now === 'function' ? env.__now() : new Date());
/** Today's date in Slovenia (Europe/Ljubljana), as YYYY-MM-DD. */
export const todayLj = (env) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowDate(env));
export const validTC = (t, c) => HEX32.test(t) && HEX32.test(c);
export const validHash = (h) => HEX64.test(h);

/** One audit object per event (never read-modify-write): who (e-mail), what, to which target, with what result, from where. */
export async function audit(env, t, ev, request) {
  if (!env.PORTAL || !HEX32.test(String(t))) return;
  const d = nowDate(env), iso = d.toISOString();
  const rec = { at: iso, email: ev.email || '', t, c: ev.c || '', action: ev.action, target: ev.target || '', result: ev.result || 'ok',
    ray: (request && request.headers.get('CF-Ray')) || '', country: (request && ((request.cf && request.cf.country) || request.headers.get('CF-IPCountry'))) || '' };
  const key = 'p/' + t + '/audit/' + iso.slice(0, 10) + '/' + iso.slice(11, 23).replace(/[:.]/g, '') + '-' + randHex(4) + '.json';
  try { await env.PORTAL.put(key, JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } }); }
  catch (e) { console.error('portal audit write failed', e && e.message); }
}
