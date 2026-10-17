// Client portal, staff side: what the owner of Business Apps publishes to the portal's bucket (binding PORTAL). Called from
// worker/index.js for /api/portal/*, after the owner's Access check and the X-Stratum-Apps header on changes; viewers never
// get here (isPrivatePath). Every client id c must exist under the caller's own tenant t (derived from the signed-in e-mail,
// never from the request), so one staff person cannot touch another's clients.
//
//   GET    /api/portal/clients                               [{ c, name, billingId, enabled, published, users }]
//   PUT    /api/portal/clients/:c   { name, billingId? }     enable (create) or rename; c = 32 hex chosen by Billing
//   DELETE /api/portal/clients/:c                            unpublish: deletes view, files, e-mail mappings (keeps responses, audit)
//   GET    /api/portal/clients/:c/view                       the published view (ETag header)
//   PUT    /api/portal/clients/:c/view?base=<etag>           publish a projection (re-whitelisted here); 409 when base is stale
//   PUT|DELETE /api/portal/clients/:c/files/:fid             a PDF or shared document (≤ 20 MB, allow-list, content checked)
//   PUT|DELETE /api/portal/users   { email, c, disabled? }   one e-mail → one client; the owner's own e-mail is refused
//   PUT    /api/portal/brand { name, accent } · /brand/logo (raw PNG/JPEG/WebP ≤ 256 KB) · PUT /news { items }
//   GET    /api/portal/responses?after=<key>                 quote decisions clients made, oldest first (Billing imports them)
//   GET    /api/portal/audit?day=YYYY-MM-DD                  that day's audit objects
import { sanitizeView, withHashes, fileIds, sanitizeBrand, sanitizeNews, FILE_TYPES, LOGO_TYPES, MAX_FILE, MAX_LOGO, MAX_VIEW_BYTES, HEX32, DAY, magicOk, emailOk, sha256hex } from './portal-schema.js';
import { json, tenantOf, userKey, emailHash, K, cPrefix, audit, nowDate } from './portal-common.js';

const bad = (msg, status = 400) => json({ error: msg }, status);
const CT = (request) => String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();

async function readBody(request, max) {
  const len = Number(request.headers.get('Content-Length'));
  if (len > max) return { tooLarge: true };
  const buf = new Uint8Array(await request.arrayBuffer());
  return buf.byteLength > max ? { tooLarge: true } : { bytes: buf };
}
async function readJson(request, max = 16 * 1024) {
  const got = await readBody(request, max);
  if (got.tooLarge) return { error: bad('Too large.', 413) };
  try { return { value: JSON.parse(new TextDecoder().decode(got.bytes)) }; } catch { return { error: bad('The body is not valid JSON.') }; }
}
async function listAll(bucket, prefix, { max = 5000, startAfter } = {}) {
  const out = []; let cursor;
  for (let i = 0; i < 20 && out.length < max; i++) {
    const page = await bucket.list({ prefix, cursor, ...(startAfter ? { startAfter } : {}) });
    out.push(...page.objects);
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return out;
}
const putJson = (bucket, key, v, opts = {}) => bucket.put(key, JSON.stringify(v), { httpMetadata: { contentType: 'application/json' }, ...opts });

export async function portalStaff(request, env, url, who) {
  if (!env.PORTAL) return bad('The client portal bucket is not connected to this site.', 503);
  const method = request.method, path = url.pathname.replace(/\/+$/, '');
  const email = who.email, t = await tenantOf(email), B = env.PORTAL;
  const log = (c, action, target, result) => audit(env, t, { email, c, action, target, result }, request);
  const need = (...ms) => (ms.includes(method) ? null : bad('Method not allowed.', 405));
  let m;

  if (path === '/api/portal/clients') {
    const r = need('GET'); if (r) return r;
    const metas = (await listAll(B, 'p/' + t + '/c/')).filter((o) => /^p\/[a-f0-9]{32}\/c\/[a-f0-9]{32}\/meta\.json$/.test(o.key)).slice(0, 200);
    const out = [];
    for (const o of metas) {
      const c = o.key.split('/')[3], meta = await B.get(o.key);
      if (!meta) continue;
      const rec = JSON.parse(await meta.text()), view = await B.head(K.view(t, c));
      out.push({ c, name: rec.name, billingId: rec.billingId || '', enabled: rec.enabled !== false, published: view ? { etag: view.etag, at: view.customMetadata && view.customMetadata.publishedAt || null } : null,
        users: (await listAll(B, cPrefix(t, c) + 'users/')).length });
    }
    return json({ clients: out });
  }

  if ((m = path.match(/^\/api\/portal\/clients\/([^/]+)$/))) {
    const c = m[1];
    if (!HEX32.test(c)) return bad('Bad address.');
    if (method === 'PUT') {
      const body = await readJson(request); if (body.error) return body.error;
      const name = String(body.value && body.value.name || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 120);
      if (!name) return bad('The client needs a name.');
      const billingId = String(body.value.billingId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      const head = await B.head(K.meta(t, c));
      const prev = head ? JSON.parse(await (await B.get(K.meta(t, c))).text()) : null;
      const rec = { name, billingId: billingId || (prev && prev.billingId) || '', enabled: true, createdAt: (prev && prev.createdAt) || nowDate(env).toISOString() };
      const put = await putJson(B, K.meta(t, c), rec, head ? { onlyIf: { etagMatches: head.etag } } : { onlyIf: { etagDoesNotMatch: '*' } });
      if (put === null) return bad('The client was changed by someone else. Try again.', 409);
      await log(c, head ? 'staff.client.rename' : 'staff.client.enable', '', 'ok');
      return json({ ok: true, c, created: !head }, head ? 200 : 201);
    }
    if (method === 'DELETE') {
      if (!(await B.head(K.meta(t, c)))) return bad('Not found.', 404);
      let n = 0;
      const mappings = await listAll(B, cPrefix(t, c) + 'users/');
      for (const o of mappings) { await B.delete('pu/' + o.key.split('/').pop()); n++; }
      const own = (await listAll(B, cPrefix(t, c))).map((o) => o.key).filter((k) => !k.startsWith(cPrefix(t, c) + 'responses/'));
      for (let i = 0; i < own.length; i += 500) await B.delete(own.slice(i, i + 500));
      await log(c, 'staff.client.unpublish', '', 'ok');
      return json({ ok: true, removedObjects: own.length, removedUsers: n });
    }
    return bad('Method not allowed.', 405);
  }

  if ((m = path.match(/^\/api\/portal\/clients\/([^/]+)\/(view|files)(?:\/([^/]+))?$/))) {
    const [, c, kind, id] = m;
    if (!HEX32.test(c)) return bad('Bad address.');
    if (!(await B.head(K.meta(t, c)))) return bad('Not found.', 404); // no such client under this staff person's tenant
    if (kind === 'view') {
      if (id !== undefined) return bad('Not found.', 404);
      if (method === 'GET') {
        const obj = await B.get(K.view(t, c));
        return obj ? new Response(obj.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', ETag: obj.etag, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : bad('Nothing is published for this client yet.', 404);
      }
      if (method !== 'PUT') return bad('Method not allowed.', 405);
      const got = await readBody(request, MAX_VIEW_BYTES);
      if (got.tooLarge) return bad('The view is larger than 1 MB.', 413);
      let raw; try { raw = JSON.parse(new TextDecoder().decode(got.bytes)); } catch { return bad('The body is not valid JSON.'); }
      const out = sanitizeView(raw);
      if (out.error) { await log(c, 'staff.view.publish', '', 'rejected'); return bad(out.error); }
      for (const f of new Set(fileIds(out.view))) if (!(await B.head(K.file(t, c, f)))) return bad('A file the view refers to has not been uploaded yet (' + f.slice(0, 8) + '...). Upload files first, the view last.', 409);
      const view = await withHashes(out.view);
      const at = nowDate(env).toISOString();
      const head = await B.head(K.view(t, c)), base = url.searchParams.get('base') || '';
      if (head && base !== head.etag) return json({ error: 'The published view changed since you loaded it.', etag: head.etag }, 409);
      if (!head && base && base !== '0') return json({ error: 'Nothing is published yet; publish without a base.' }, 409);
      const put = await B.put(K.view(t, c), JSON.stringify({ ...view, publishedAt: at }), { httpMetadata: { contentType: 'application/json' }, customMetadata: { publishedAt: at },
        onlyIf: head ? { etagMatches: head.etag } : { etagDoesNotMatch: '*' } });
      if (put === null) return json({ error: 'The published view changed at the same moment. Reload and try again.' }, 409);
      await log(c, 'staff.view.publish', view.invoices.length + ' invoices, ' + view.quotes.length + ' quotes, ' + view.documents.length + ' documents', 'ok');
      return json({ ok: true, etag: put.etag, publishedAt: at, quoteHashes: Object.fromEntries(view.quotes.map((q) => [q.id, q.hash])) });
    }
    // files
    if (id === undefined || !HEX32.test(id)) return bad('Bad address.');
    if (method === 'DELETE') { await B.delete(K.file(t, c, id)); await log(c, 'staff.file.delete', id.slice(0, 8), 'ok'); return json({ ok: true }); }
    if (method !== 'PUT') return bad('Method not allowed.', 405);
    const type = CT(request);
    if (!FILE_TYPES[type]) return bad('This file type is not allowed. Allowed: PDF, PNG, JPEG, DOCX, XLSX, CSV.', 415);
    const got = await readBody(request, MAX_FILE);
    if (got.tooLarge) return bad('The file is larger than 20 MB.', 413);
    if (!magicOk(type, got.bytes)) { await log(c, 'staff.file.put', id.slice(0, 8), 'rejected-content'); return bad('The file does not look like a ' + FILE_TYPES[type].toUpperCase() + '.', 415); }
    await B.put(K.file(t, c, id), got.bytes, { httpMetadata: { contentType: type }, customMetadata: { size: String(got.bytes.byteLength) } });
    await log(c, 'staff.file.put', id.slice(0, 8) + ' ' + type, 'ok');
    return json({ ok: true, size: got.bytes.byteLength });
  }

  if (path === '/api/portal/users') {
    if (method !== 'PUT' && method !== 'DELETE') return bad('Method not allowed.', 405);
    const body = await readJson(request); if (body.error) return body.error;
    const e = String(body.value && body.value.email || '').trim().toLowerCase(), c = body.value && body.value.c;
    if (!emailOk(e)) return bad('That does not look like an e-mail address.');
    if (typeof c !== 'string' || !HEX32.test(c)) return bad('Bad client id.');
    if (!(await B.head(K.meta(t, c)))) return bad('Not found.', 404);
    const key = await userKey(e), h = await emailHash(e);
    if (method === 'DELETE') {
      const cur = await B.get(key), rec = cur ? JSON.parse(await cur.text()) : null;
      if (!rec || rec.t !== t || rec.c !== c) return bad('Not found.', 404);
      await B.delete([key, K.marker(t, c, h)]);
      await log(c, 'staff.user.remove', h.slice(0, 8), 'ok');
      return json({ ok: true });
    }
    const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
    const staffList = [owner, ...String(env.VIEWER_EMAILS || '').toLowerCase().split(/[\s,;]+/)].filter(Boolean);
    if (staffList.includes(e)) { await log(c, 'staff.user.add', h.slice(0, 8), 'refused-staff-email'); return bad('A staff e-mail cannot be a portal client. Use a separate address for the test client.', 400); }
    const disabled = body.value.disabled === true;
    const cur = await B.get(key);
    if (cur) {
      const rec = JSON.parse(await cur.text());
      if (rec.t !== t || rec.c !== c) return bad('This e-mail already belongs to another portal client.', 409);
      await putJson(B, key, { ...rec, disabled }, { onlyIf: { etagMatches: cur.etag } });
      await log(c, disabled ? 'staff.user.disable' : 'staff.user.enable', h.slice(0, 8), 'ok');
      return json({ ok: true, disabled });
    }
    const made = await putJson(B, key, { t, c, addedAt: nowDate(env).toISOString(), addedBy: (await sha256hex('by:' + email)).slice(0, 12), disabled }, { onlyIf: { etagDoesNotMatch: '*' } });
    if (made === null) return bad('This e-mail already belongs to another portal client.', 409); // created a moment ago by someone else
    await putJson(B, K.marker(t, c, h), { at: nowDate(env).toISOString() });
    await log(c, 'staff.user.add', h.slice(0, 8), 'ok');
    return json({ ok: true, disabled }, 201);
  }

  if (path === '/api/portal/brand') {
    const r = need('PUT'); if (r) return r;
    const body = await readJson(request); if (body.error) return body.error;
    const out = sanitizeBrand(body.value); if (out.error) return bad(out.error);
    const prev = await B.get(K.brand(t));
    const old = prev ? JSON.parse(await prev.text()) : {};
    await putJson(B, K.brand(t), { ...out.brand, logo: !!old.logo });
    await log('', 'staff.brand.put', '', 'ok');
    return json({ ok: true });
  }
  if (path === '/api/portal/brand/logo') {
    if (method === 'DELETE') {
      await B.delete(K.logo(t));
      const prev = await B.get(K.brand(t));
      if (prev) await putJson(B, K.brand(t), { ...JSON.parse(await prev.text()), logo: false });
      return json({ ok: true });
    }
    const r = need('PUT'); if (r) return r;
    const type = CT(request);
    if (!LOGO_TYPES[type]) return bad('The logo must be PNG, JPEG or WebP (not SVG).', 415);
    const got = await readBody(request, MAX_LOGO);
    if (got.tooLarge) return bad('The logo is larger than 256 KB.', 413);
    if (!magicOk(type, got.bytes)) return bad('The file does not look like a ' + LOGO_TYPES[type].toUpperCase() + '.', 415);
    const prev = await B.get(K.brand(t));
    if (!prev) return bad('Save the brand (name and colour) first.', 409);
    await B.put(K.logo(t), got.bytes, { httpMetadata: { contentType: type } });
    await putJson(B, K.brand(t), { ...JSON.parse(await prev.text()), logo: true });
    await log('', 'staff.brand.logo', type, 'ok');
    return json({ ok: true });
  }
  if (path === '/api/portal/news') {
    const r = need('PUT'); if (r) return r;
    const body = await readJson(request, 64 * 1024); if (body.error) return body.error;
    const out = sanitizeNews(body.value); if (out.error) return bad(out.error);
    await putJson(B, K.news(t), out.news);
    await log('', 'staff.news.put', out.news.items.length + ' items', 'ok');
    return json({ ok: true });
  }

  if (path === '/api/portal/responses') {
    const r = need('GET'); if (r) return r;
    const after = url.searchParams.get('after') || '', root = 'p/' + t + '/c/';
    if (after && !new RegExp('^' + root + '[a-f0-9]{32}/responses/[0-9a-f-]{36}\\.json$').test(after)) return bad('Bad address.');
    const keys = (await listAll(B, root, { startAfter: after || undefined })).map((o) => o.key).filter((k) => /\/responses\/[0-9a-f-]{36}\.json$/.test(k)).sort();
    const out = [];
    for (const key of keys.slice(0, 50)) { const o = await B.get(key); if (o) out.push({ key, c: key.split('/')[3], ...JSON.parse(await o.text()) }); }
    return json({ responses: out, last: out.length ? out[out.length - 1].key : after, more: keys.length > 50 });
  }
  if (path === '/api/portal/audit') {
    const r = need('GET'); if (r) return r;
    const day = url.searchParams.get('day') || nowDate(env).toISOString().slice(0, 10);
    if (!DAY.test(day)) return bad('Bad day.');
    const keys = (await listAll(B, 'p/' + t + '/audit/' + day + '/', { max: 200 })).map((o) => o.key).slice(0, 200);
    const out = [];
    for (const key of keys) { const o = await B.get(key); if (o) out.push(JSON.parse(await o.text())); }
    return json({ day, events: out });
  }
  return bad('Not found.', 404);
}
