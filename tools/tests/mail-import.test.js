// Tests for Clearfigure Mail: subscriber CSV import (site/mail/importer.js), the SMS "Replace č/š/ž" fixer
// (site/mail/util.js), the Refill → Mail handover (site/mail/handoff.js) and the dashboard's opening story
// (site/mail/data.js). Run: node tools/tests/mail-import.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const DIR = path.join(__dirname, '../../site/mail');
const IM = require(path.join(DIR, 'importer.js'));
const H = require(path.join(DIR, 'handoff.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// util.js, engine.js and data.js are browser scripts: run them in a small sandbox with a fixed clock
function sandbox(fixedNow) {
  class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(fixedNow); } static now() { return fixedNow; } }
  const ctx = { console, Date: fixedNow ? FD : Date, Math, JSON, Map, Set, Promise, Intl, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.document = { addEventListener() {}, getElementById() { return null; } };
  ctx.localStorage = { getItem() { return null; }, setItem() {} };
  vm.createContext(ctx);
  return (files) => { files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f })); return ctx.AM; };
}
const U = sandbox()(['util.js']).U;

// ── CSV parsing and column guesses ───────────────────────────────────────
t('parse: semicolons, quotes, BOM, CRLF, blank lines', () => {
  const p = IM.parse('﻿email;ime;opomba\r\nana@example.si;Ana;"ima ; podpičje"\r\n\r\nmarko@example.hr;Marko;"rekel je ""da"""\r\n');
  assert.strictEqual(p.delim, ';');
  assert.deepStrictEqual(p.headers, ['email', 'ime', 'opomba']);
  assert.strictEqual(p.rows.length, 2);
  assert.strictEqual(p.rows[0][2], 'ima ; podpičje');
  assert.strictEqual(p.rows[1][2], 'rekel je "da"');
});
t('parse: commas and tabs are detected', () => {
  assert.strictEqual(IM.parse('a,b,c\n1,2,3').delim, ',');
  assert.strictEqual(IM.parse('a\tb\n1\t2').delim, '\t');
  assert.strictEqual(IM.parse('email,first\n"x@example.si, y",Ana').rows[0][0], 'x@example.si, y');
});
t('guess: SL/HR/EN headers map to fields', () => {
  assert.deepStrictEqual(IM.guess(IM.SAMPLE[0]), ['email', 'first', 'last', 'phone', 'country', 'lang', 'city', 'emC', 'emAt', 'emSrc', 'smsC', 'smsAt', 'smsSrc']);
  assert.deepStrictEqual(IM.guess(['E-mail', 'Ime in priimek', 'Mobitel', 'Datum privole', 'Izvor privole', 'Newsletter', 'Loyalty tier']), ['email', 'name', 'phone', 'emAt', 'emSrc', 'emC', 'prop']);
  assert.deepStrictEqual(IM.guess(['Email', 'First Name', 'Last Name', 'Accepts Email Marketing', 'Accepts SMS Marketing', 'Phone']), ['email', 'first', 'last', 'emC', 'smsC', 'phone']);
  assert.deepStrictEqual(IM.guess(['email', 'Email']), ['email', 'prop'], 'a field is picked once');
});

// ── value parsers ────────────────────────────────────────────────────────
t('parseDate: Slovenian, ISO and day-first formats; rejects impossible dates', () => {
  const ymdhm = (ms) => { const d = new Date(ms); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]; };
  assert.deepStrictEqual(ymdhm(IM.parseDate('15. 10. 2026')), [2026, 10, 15, 0, 0]);
  assert.deepStrictEqual(ymdhm(IM.parseDate('15.10.2026 14:05')), [2026, 10, 15, 14, 5]);
  assert.deepStrictEqual(ymdhm(IM.parseDate('2026-03-01')), [2026, 3, 1, 0, 0]);
  assert.deepStrictEqual(ymdhm(IM.parseDate('03/04/2025')), [2025, 4, 3, 0, 0], 'day first');
  assert.strictEqual(IM.parseDate('2026-01-02T10:00:00Z'), Date.UTC(2026, 0, 2, 10));
  assert.strictEqual(IM.parseDate('31. 2. 2026'), null);
  assert.strictEqual(IM.parseDate('yesterday'), null);
  assert.strictEqual(IM.parseDate(''), null);
});
t('parseConsent: yes / no / withdrawn in SL, HR and EN', () => {
  ['da', 'Yes', 'TRUE', '1', 'x', 'subscribed', 'Prijavljen'].forEach((v) => assert.strictEqual(IM.parseConsent(v), 'yes', v));
  ['ne', 'no', '0', 'false', 'never'].forEach((v) => assert.strictEqual(IM.parseConsent(v), 'no', v));
  ['odjavljen', 'Unsubscribed', 'opt-out', 'preklicano'].forEach((v) => assert.strictEqual(IM.parseConsent(v), 'unsub', v));
  assert.strictEqual(IM.parseConsent(''), '');
  assert.strictEqual(IM.parseConsent('maybe'), null);
});
t('parsePhone: SI/HR national, 00 and +; rejects junk', () => {
  assert.deepStrictEqual(IM.parsePhone('041 000 101', 'SI'), { phone: '+386 41 000 101', country: 'SI' });
  assert.deepStrictEqual(IM.parsePhone('091/000-202', 'HR'), { phone: '+385 91 000 202', country: 'HR' });
  assert.deepStrictEqual(IM.parsePhone('00385 91 000 2020'), { phone: '+385 91 000 2020', country: 'HR' });
  assert.strictEqual(IM.parsePhone('+386 41 000 101').country, 'SI');
  assert.strictEqual(IM.parsePhone('call me'), null);
  assert.deepStrictEqual(IM.parsePhone(''), { phone: '', country: '' });
});
t('parseCountry / parseLang', () => {
  assert.strictEqual(IM.parseCountry('Slovenija'), 'SI');
  assert.strictEqual(IM.parseCountry('Hrvatska'), 'HR');
  assert.strictEqual(IM.parseCountry('CRO'), 'HR');
  assert.strictEqual(IM.parseCountry('Austria'), null);
  assert.strictEqual(IM.parseLang('slovenščina'), 'sl');
  assert.strictEqual(IM.parseLang('hrvatski'), 'hr');
  assert.strictEqual(IM.parseLang('EN'), 'en');
});

// ── the plan: consent you can prove (GDPR Art. 7) ────────────────────────
const NOW = new Date(2026, 9, 15, 12).getTime();
function planOf(text, existing, opt) {
  const p = IM.parse(text), map = IM.guess(p.headers);
  const ex = new Map((existing || []).map((x) => [x.email, x]));
  return IM.plan(p.headers, p.rows, map, Object.assign({ existing: (e) => ex.get(e) || null, now: NOW, file: 'test.csv', defaultCountry: 'SI' }, opt || {}));
}
t('plan: the sample file — consent with date and source is imported, without proof it is not', () => {
  const text = IM.SAMPLE.map((r) => r.join(';')).join('\n');
  const pl = planOf(text);
  assert.strictEqual(pl.create.length, 3);
  const [ana, marko, eva] = pl.create;
  assert.deepStrictEqual([ana.em.s, ana.sms.s], ['subscribed', 'subscribed']);
  assert.strictEqual(ana.em.src, 'Spletna blagajna');
  assert.strictEqual(IM.ymd(ana.em.at), '2025-03-03');
  assert.strictEqual(ana.set.phone, '+386 41 000 101');
  assert.strictEqual(marko.set.country, 'HR');
  assert.strictEqual(marko.set.lang, 'hr');
  assert.strictEqual(marko.em.s, 'subscribed');
  assert.strictEqual(marko.sms.s, 'never');
  assert.strictEqual(eva.em.s, 'never', 'yes without date and source → no marketing consent');
  assert.strictEqual(eva.set.country, 'SI');
  assert.strictEqual(pl.stats.noProof, 1);
  assert.ok(pl.notes.some((x) => x.email === 'eva.test@example.si' && /Art\. 7\(1\)/.test(x.note)));
});
t('plan: "record with import date" option keeps the gap visible in the source', () => {
  const pl = planOf('email;newsletter\neva@example.si;da', null, { missingProof: 'importDate', defaultSource: '' });
  const r = pl.create[0];
  assert.strictEqual(r.em.s, 'subscribed');
  assert.strictEqual(r.em.at, NOW);
  assert.ok(/recorded at import \(test\.csv\)/.test(r.em.src));
});
t('plan: a default source fills empty source cells (the date is still required)', () => {
  const pl = planOf('email;newsletter;consent date\na@example.si;da;1. 2. 2025\nb@example.si;da;', null, { defaultSource: 'Webshop checkout' });
  assert.strictEqual(pl.create[0].em.s, 'subscribed');
  assert.strictEqual(pl.create[0].em.src, 'Webshop checkout');
  assert.strictEqual(pl.create[1].em.s, 'never');
});
t('plan: skips bad and duplicate e-mails, needs an Email column', () => {
  const pl = planOf('email;ime\nnot-an-email;X\nana@example.si;Ana\nANA@example.si;Ana2\n;Nobody');
  assert.strictEqual(pl.create.length, 1);
  assert.deepStrictEqual(pl.skip.map((s) => s.reason), ['Not a valid email address', 'Duplicate of line 3 in this file', 'No email address']);
  assert.ok(IM.plan(['ime'], [['Ana']], ['first'], {}).error);
});
t('plan: withdrawal wins over an older consent; a newer consent re-subscribes; suppressed stays', () => {
  const unsubAt = new Date(2026, 5, 1).getTime();
  const existing = [
    { email: 'old@example.si', country: 'SI', em: { s: 'unsubscribed', at: unsubAt }, sms: { s: 'never', at: 0 }, props: {} },
    { email: 'new@example.si', country: 'SI', em: { s: 'unsubscribed', at: unsubAt }, sms: { s: 'never', at: 0 }, props: {} },
    { email: 'sup@example.si', country: 'SI', em: { s: 'never', at: 0 }, sms: { s: 'never', at: 0 }, sup: { r: 'Hard bounce', at: 1 }, props: {} }
  ];
  const pl = planOf('email;newsletter;datum soglasja;vir soglasja\nold@example.si;da;1. 1. 2026;Obrazec\nnew@example.si;da;1. 9. 2026;Obrazec\nsup@example.si;da;1. 9. 2026;Obrazec', existing);
  assert.deepStrictEqual(pl.update.map((r) => r.email), ['new@example.si']);
  assert.strictEqual(pl.update[0].em.s, 'subscribed');
  assert.deepStrictEqual(pl.skip.map((s) => s.email).sort(), ['old@example.si', 'sup@example.si']);
  assert.ok(pl.notes.some((x) => x.email === 'old@example.si' && /Art\. 7\(3\)/.test(x.note)));
});
t('plan: explicit "unsubscribed" is applied to a subscribed profile', () => {
  const existing = [{ email: 'a@example.si', country: 'SI', em: { s: 'subscribed', at: 1, src: 'Form' }, sms: { s: 'never', at: 0 }, props: {} }];
  const pl = planOf('email;newsletter\na@example.si;odjavljen', existing);
  assert.strictEqual(pl.update[0].em.s, 'unsubscribed');
  assert.strictEqual(pl.stats.unsub, 1);
});
t('plan: SMS consent needs a phone number; updates off skips existing', () => {
  const pl = planOf('email;sms soglasje;sms datum;sms vir\na@example.si;da;1. 1. 2026;Tablica');
  assert.strictEqual(pl.create[0].sms.s, 'never');
  assert.ok(pl.notes.some((x) => /without a phone number/.test(x.note)));
  const ex = [{ email: 'a@example.si', country: 'SI', em: { s: 'never', at: 0 }, sms: { s: 'never', at: 0 }, props: {} }];
  assert.strictEqual(planOf('email;ime\na@example.si;Ana', ex, { update: false }).skip.length, 1);
});
t('plan: future consent dates are not used; custom columns become properties', () => {
  const pl = planOf('email;newsletter;consent date;consent source;Loyalty tier\na@example.si;yes;1. 1. 2030;Form;Gold');
  assert.strictEqual(pl.create[0].em.s, 'never');
  assert.deepStrictEqual(pl.create[0].props, { loyalty_tier: 'Gold' });
});

// ── SMS: GSM-7 and "Replace č/š/ž" ───────────────────────────────────────
t('smsInfo: č forces UCS-2, the fixer brings it back to GSM-7 and saves segments', () => {
  const text = 'Clearfigure: teden pregledov vida — brezplačen pregled ob nakupu očal. Rezerviraj termin že danes v vaši najbližji trgovini: https://s.example/pv Odjava: STOP';
  const before = U.smsInfo(text);
  assert.strictEqual(before.encoding, 'UCS-2 (Unicode)');
  assert.strictEqual(before.segments, 3);
  const fix = U.gsmSafe(text);
  assert.strictEqual(fix.text, 'Clearfigure: teden pregledov vida - brezplacen pregled ob nakupu ocal. Rezerviraj termin ze danes v vasi najblizji trgovini: https://s.example/pv Odjava: STOP');
  assert.strictEqual(fix.replaced, 6);
  assert.strictEqual(fix.left.length, 0);
  const after = U.smsInfo(fix.text);
  assert.strictEqual(after.encoding, 'GSM-7');
  assert.strictEqual(after.segments, 1);
});
t('gsmSafe: keeps GSM letters (é, ü, €), maps Croatian and typography, reports emoji', () => {
  const r = U.gsmSafe('Ćevapi đir Žiga — “é ü” 10 € … 🙂');
  assert.ok(r.text.startsWith('Cevapi dir Ziga - "é ü" 10 € ...'));
  assert.ok(r.left.length > 0, 'emoji left for the user');
  assert.strictEqual(U.gsmSafe('plain text').replaced, 0);
  assert.strictEqual(U.smsInfo('€').chars, 2, '€ is a GSM-7 extension character');
});

// ── Refill → Clearfigure Mail handover ───────────────────────────────────────
t('handoff: validity checks', () => {
  const ok = { v: 1, from: 'refill', at: NOW, market: 'SI', action: 'Refill reminder', bucket: '1 0-7' };
  assert.strictEqual(H.valid(ok, NOW + 1000), '');
  assert.ok(/older than 2 hours/.test(H.valid(ok, NOW + 3 * 3600e3)));
  assert.ok(/Slovenia and Croatia/.test(H.valid(Object.assign({}, ok, { market: 'IT' }), NOW)));
  assert.ok(H.valid(Object.assign({}, ok, { action: 'No contact' }), NOW));
  assert.ok(H.valid(null, NOW) === '' ? false : true);
  assert.ok(H.valid({ v: 1, from: 'crm', at: NOW }, NOW));
});
t('handoff: segment definitions follow market, action and runout window', () => {
  const d1 = H.segmentDef({ market: 'HR', action: 'Refill reminder', bucket: '2 8-14' });
  assert.deepStrictEqual(d1.groups[0].conds, [{ kind: 'prop', field: 'country', op: 'eq', value: 'HR' }, { kind: 'consent', channel: 'email', value: 'can' }, { kind: 'prop', field: 'props.lens_refill_date', op: 'next', value: 14 }]);
  const d2 = H.segmentDef({ market: 'SI', action: 'Refill reminder', bucket: '0 overdue' });
  assert.strictEqual(d2.groups[0].conds[2].op, 'last');
  const d3 = H.segmentDef({ market: 'SI', action: 'Refill reminder' });
  assert.strictEqual(d3.groups[1].match, 'any');
  const w = H.segmentDef({ market: 'CRO', action: 'Win-back offer' }), l = H.segmentDef({ market: 'SI', action: 'Low-cost win-back (email only)' });
  assert.strictEqual(w.groups[0].conds[0].value, 'HR', 'the old CRO code still maps to Croatia');
  assert.deepStrictEqual([w.groups[1].conds[2].op, l.groups[1].conds[2].op], ['gt', 'lt']);
  H.ACTIONS.forEach((a) => assert.ok(H.COPY[a].SI[0] && H.COPY[a].HR[0], a));
});
t('handoff: definitions match real profiles in the demo data', () => {
  const AM = sandbox(new Date(2026, 9, 15, 9).getTime())(['util.js', 'email.js', 'engine.js', 'data.js']);
  const db = AM.Data.generate(); AM.E.init(db);
  const n = (h) => AM.E.members(H.segmentDef(h)).length;
  assert.ok(n({ market: 'SI', action: 'Refill reminder' }) > 0, 'refill reminder SI');
  assert.ok(n({ market: 'HR', action: 'Reminder + small incentive' }) > 0, 'incentive HR');
  assert.ok(n({ market: 'SI', action: 'Low-cost win-back (email only)' }) > 0, 'low-cost win-back SI');
  // ── and the dashboard opens on a positive story: a campaign and an SMS in the last 30 days, revenue up
  const E = AM.E, now = E.now(), DAY = AM.U.DAY;
  const recent = db.campaigns.filter((c) => c.status === 'sent' && c.sentAt > now - 30 * DAY);
  assert.ok(recent.some((c) => c.channel === 'email' && /Frames week/.test(c.name)), 'promo campaign inside 30 days');
  assert.ok(recent.some((c) => c.channel === 'sms'), 'SMS inside 30 days');
  const cur = E.period(now - 30 * DAY, now), prev = E.period(now - 60 * DAY, now - 30 * DAY - 1);
  assert.ok(cur.revenue > prev.revenue, 'revenue up vs the previous 30 days (' + Math.round(cur.revenue) + ' vs ' + Math.round(prev.revenue) + ')');
  assert.ok(cur.smsRev > 0, 'SMS revenue in the last 30 days');
});

console.log('\nall ' + n + ' mail tests passed');
