// Cloudflare Access check for the Business Apps API (the same check as my-apps/shared/access.mjs).
// identity(request, env) verifies the Cf-Access-Jwt-Assertion token (RS256 signature against the team's public keys,
// issuer, audience, expiry) and that its e-mail is the owner's. Needs ACCESS_TEAM_DOMAIN, ACCESS_AUD and OWNER_EMAIL;
// without them every request is refused (fails closed). The Access application already blocks everyone else at the
// edge; this second check also covers addresses Access does not front (for example version preview URLs).
// View-only people: VIEWER_EMAILS (a Worker secret, comma-separated, may be empty; never in this public repository; the
// e-mails are also allowed in the Access policy) may read the owner's cloud copies of the demo apps (GET and HEAD) but
// never change anything, and never read the private apps in PRIVATE_APPS (their data, files and history).

let certs = { at: 0, keys: [] };
function b64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function accessKeys(team, refresh) {
  if (!refresh && certs.keys.length && Date.now() - certs.at < 3600e3) return certs.keys;
  const r = await fetch('https://' + team + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Access certs unavailable');
  const j = await r.json();
  certs = { at: Date.now(), keys: Array.isArray(j.keys) ? j.keys : [] };
  return certs.keys;
}

/** Apps whose cloud copies only the owner may read (real business data). */
export const PRIVATE_APPS = ['billing', 'invoices', 'desk', 'cashflow', 'client-atlas', 'home'];
/** Is this request path about a private app's cloud copy (/api/sync/<app>, its files or its history) or the website messages (/api/leads)? */
export function isPrivatePath(pathname) {
  if (/^\/api\/leads(\/|$)/.test(String(pathname || ''))) return true; // contact-form messages from the public site: owner only
  const m = String(pathname || '').match(/^\/api\/sync\/([^/]*)/);
  if (!m) return false;
  let app;
  try { app = decodeURIComponent(m[1]); } catch { return true; } // undecodable: refuse
  return PRIVATE_APPS.includes(app.trim().toLowerCase());
}
/** View-only e-mails from VIEWER_EMAILS (comma, space or semicolon separated), lowercased. */
export const viewerEmails = (env) => String(env?.VIEWER_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter((e) => e.includes('@'));
/** → { email } for the owner, { email: owner, viewer } for a view-only person reading (GET/HEAD) a demo app, or { error }
 * ('setup' | 'signin' | 'owner' | 'viewonly' (a viewer trying to change something) | 'private' (a viewer reading a
 * private app)). Throws if Access keys cannot be fetched. */
export async function identity(request, env) {
  const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !owner) return { error: 'setup' };
  const v = await verifiedEmail(request, env);
  if (v.error) return v;
  const email = v.email;
  if (email && email !== owner && viewerEmails(env).includes(email)) { // view-only: the owner's demo data, never a change
    if (request.method !== 'GET' && request.method !== 'HEAD') return { error: 'viewonly', email };
    if (isPrivatePath(new URL(request.url).pathname)) return { error: 'private', email };
    return { email: owner, viewer: email };
  }
  if (!email || email !== owner) return { error: 'owner' };
  return { email };
}

/** True for localhost, 127.0.0.1, [::1] and *.localhost (the only hosts where DEV_BYPASS may ever work). */
export const isLocalHost = (host) => { host = String(host || '').toLowerCase(); return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost'); };

/** The e-mail in a valid Access token (signature, issuer, audience, expiry), whoever it is: → { email } (lowercased) or
 * { error: 'setup' | 'signin' }. identity() adds the owner/viewer rules on top; team workspaces (worker/workspaces.js) add
 * their own membership check; the client portal (worker/portal.js) passes its own audience.
 * opts.aud: the audience this caller accepts (default env.ACCESS_AUD, the staff app). opts.otherAud: the audience of the
 * other Access app on the same team (default env.PORTAL_ACCESS_AUD): a token that lists it is refused even if it also lists
 * ours, because both apps share one issuer and the audience is the only thing that separates a client from a staff token.
 * Tokens without an e-mail (service tokens) are refused. Throws if Access keys cannot be fetched (callers answer 503). */
export async function verifiedEmail(request, env, opts = {}) {
  const team = env.ACCESS_TEAM_DOMAIN, aud = opts.aud === undefined ? env.ACCESS_AUD : opts.aud;
  const other = opts.otherAud === undefined ? env.PORTAL_ACCESS_AUD : opts.otherAud;
  if (!team || !aud) return { error: 'setup' };
  if (other && other === aud) return { error: 'setup' }; // the two apps must have different audiences
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { error: 'signin' };
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'signin' };
  let header, payload;
  try { header = decodeJson(parts[0]); payload = decodeJson(parts[1]); } catch { return { error: 'signin' }; }
  if (!header || !payload || typeof payload !== 'object') return { error: 'signin' };
  if (header.alg !== 'RS256' || !header.kid) return { error: 'signin' };
  let jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find((k) => k.kid === header.kid);
  if (!jwk) return { error: 'signin' };
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  let sig;
  try { sig = b64url(parts[2]); } catch { return { error: 'signin' }; }
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return { error: 'signin' };
  const now = Date.now() / 1000, auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud) || (other && auds.includes(other)) || !(payload.exp > now) || (payload.nbf && payload.nbf > now + 60) || payload.iss !== 'https://' + team) return { error: 'signin' };
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return { error: 'signin' };
  return { email };
}
