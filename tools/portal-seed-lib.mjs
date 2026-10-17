// Seeds the client-portal demo through the STAFF API (/api/portal/*) exactly as Billing will publish: files first, the view
// last. Two fictional companies (Alder & Finch Studio with clients Lindgren Café and Birch Bakery; Harbor Light Studio with
// Northwind Outfitters), fictional e-mails on example.test. Used by tools/portal-publish.mjs (against wrangler dev) and
// tools/portal-dev-server.mjs (in-process). `staff(company, method, path, body, headers)` must return { status, text }.
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const P = require('../site/billing/portal-projection.js');
const { buildDemoState, COMPANIES } = require('./portal-demo-state.js');

export const DEMO_USERS = {
  'client-a@example.test': { company: 'alder', client: 'cl-lindgren', name: 'Elena' },
  'client-b@example.test': { company: 'alder', client: 'cl-birch', name: 'Jonas' },
  'client-x@example.test': { company: 'harbor', client: 'cl-north', name: 'Mara' },
};
const hex32 = (s) => Array.from(Buffer.from(s.padEnd(16, '.')).subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
export const clientId = (billingId) => hex32(billingId);

// ── a tiny PNG logo (no libraries): rounded square in the accent colour with a white mark ─────────────────────────────
function crc32(buf) { let c, crc = ~0; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const b = Buffer.alloc(8 + data.length + 4); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; }
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
export function logoPng(accent, shape = 'peak', N = 112) {
  const rgb = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16)), k = N / 28, raw = Buffer.alloc(N * (N * 4 + 1));
  const segs = shape === 'peak' ? [[7, 21, 14, 7], [14, 7, 21, 21], [10, 16, 18, 16]] : [[8, 17, 11, 12], [11, 12, 14, 17], [14, 17, 17, 12], [17, 12, 20, 17]];
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / k, py = (y + 0.5) / k, r = 6;
      const cx = Math.max(r, Math.min(28 - r, px)), cy = Math.max(r, Math.min(28 - r, py)), inside = Math.hypot(px - cx, py - cy) <= r ? 1 : 0;
      const d = Math.min(...segs.map((s) => segDist(px, py, ...s))), ink = Math.max(0, Math.min(1, 1.2 - d / 1.2 * 1.0 + 0.3)) * (d < 1.4 ? 1 : 0);
      const o = y * (N * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(rgb[i] * (1 - ink) + 255 * ink);
      raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A small but real one-page PDF with a line of text. */
export function samplePdf(title) {
  const esc = (s) => s.replace(/[\\()]/g, ' ').replace(/[^\x20-\x7e]/g, '?');
  const stream = 'BT /F1 18 Tf 72 720 Td (' + esc(title) + ') Tj 0 -28 Td /F1 11 Tf (Sample document with fictional data.) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length; out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

export async function seedDemo(staff, { today = '2026-10-17', log = () => {}, companies = Object.keys(COMPANIES) } = {}) {
  const must = async (company, method, path, body, headers) => { const r = await staff(company, method, path, body, headers); if (r.status >= 400) throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + r.text); return r; };
  const out = { users: DEMO_USERS, clients: {} };
  for (const [company, def] of Object.entries(COMPANIES).filter(([k]) => companies.includes(k))) {
    const state = buildDemoState(company);
    await must(company, 'PUT', '/api/portal/brand', { name: def.name, accent: def.accent });
    await must(company, 'PUT', '/api/portal/brand/logo', logoPng(def.accent, company === 'alder' ? 'peak' : 'ring'), { 'Content-Type': 'image/png' });
    await must(company, 'PUT', '/api/portal/news', { items: company === 'alder'
      ? [{ date: '2026-10-14', title: 'Studio closed 2 to 4 November', body: 'We are at a print fair. Urgent requests still reach us by e-mail.' }, { date: '2026-10-01', title: 'New: invoices payable by bank transfer QR', body: 'Scan the code on any invoice from your banking app.' }, { date: '2026-09-18', title: 'Welcome, Jonas Berg, junior designer', body: 'Jonas joins the brand team this month.' }]
      : [{ date: '2026-10-12', title: 'Autumn catalogue shoot booked', body: 'Dates are confirmed for the last week of October.' }] });
    for (const bc of def.clients) {
      const c = clientId(bc.id), pdfs = {}, files = [], docs = [];
      await must(company, 'PUT', '/api/portal/clients/' + c, { name: bc.name, billingId: bc.id });
      const view0 = P.buildProjection(state, bc.id, { today });
      view0.invoices.filter((i) => i.kind === 'invoice').forEach((i, n) => { if (n < 2) { const f = hex32(i.number + 'pdf'); pdfs[i.id] = f; files.push([f, 'Invoice ' + i.number]); } });
      view0.quotes.forEach((q) => { const f = hex32(q.number + 'pdf'); pdfs[q.id] = f; files.push([f, 'Quote ' + q.number]); });
      if (company === 'alder' && bc.id === 'cl-lindgren') for (const [name, size, at] of [['Brand guidelines v3.pdf', 4404019, '2026-10-09'], ['Signage proof, front window.pdf', 1887437, '2026-10-02'], ['Logo files, final.pdf', 12582912, '2026-09-21']]) {
        const f = hex32(name); docs.push({ id: f, name, size, type: 'application/pdf', sharedAt: at }); files.push([f, name]);
      }
      for (const [f, title] of files) await must(company, 'PUT', '/api/portal/clients/' + c + '/files/' + f, samplePdf(title), { 'Content-Type': 'application/pdf' });
      const r = await must(company, 'PUT', '/api/portal/clients/' + c + '/view', P.buildProjection(state, bc.id, { today, pdfs, documents: docs }));
      out.clients[bc.id] = { c, etag: JSON.parse(r.text).etag };
      log('published ' + bc.name);
    }
  }
  for (const [email, u] of Object.entries(DEMO_USERS).filter(([, u]) => companies.includes(u.company))) await must(u.company, 'PUT', '/api/portal/users', { email, c: clientId(u.client), name: u.name });
  return out;
}
