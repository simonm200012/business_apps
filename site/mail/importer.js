/* Tokovi Mail — subscriber CSV import: parsing (";" or "," or tab, quotes, BOM), column mapping with
 * EN/SL/HR header guesses, and a dry-run plan (new / update / skip, with reasons) that the Profiles page
 * shows before anything is saved. Pure functions, no DOM: also loaded by tools/tests/mail-import.test.js.
 *
 * Consent rules (GDPR, Regulation (EU) 2016/679):
 *  - Art. 7(1): the controller must be able to demonstrate consent → a "yes" is only imported as a marketing
 *    subscription when the row also carries the consent date and source (or the user explicitly chooses a
 *    fallback for missing ones, which is then written into the source so it stays visible).
 *  - Art. 7(3): withdrawal must be respected → an existing unsubscribe newer than the file's consent date is
 *    kept, a suppressed profile is never re-subscribed, and an explicit "unsubscribed" in the file is applied.
 *  - SMS consent also needs a phone number. Marketing SMS need prior consent under the ePrivacy Directive
 *    2002/58/EC Art. 13(1), transposed in SI by ZEKom-2 and in HR by ZEK (NN 76/22) — Simon to confirm the
 *    national article numbers before quoting them to a customer.
 */
(function (root) {
  'use strict';
  var I = {};
  var DAY = 864e5;

  // ── CSV parsing ────────────────────────────────────────────────────────
  I.detectDelim = function (text) {
    var line = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '';
    var best = ',', n = -1;
    [';', ',', '\t'].forEach(function (d) {
      var c = 0, q = false;
      for (var i = 0; i < line.length; i++) { var ch = line.charAt(i); if (ch === '"') q = !q; else if (!q && ch === d) c++; }
      if (c > n) { n = c; best = d; }
    });
    return best;
  };
  I.parse = function (text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    var d = delim || I.detectDelim(text), rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    var headers = (rows.shift() || []).map(function (h) { return String(h).trim(); });
    return { delim: d, headers: headers, rows: rows.map(function (r) { return headers.map(function (_, k) { return String(r[k] == null ? '' : r[k]).trim(); }); }) };
  };

  // ── Fields and header guesses ──────────────────────────────────────────
  I.FIELDS = [
    ['email', 'Email (required)'], ['first', 'First name'], ['last', 'Last name'], ['name', 'Full name (split)'], ['phone', 'Phone'],
    ['country', 'Country'], ['lang', 'Language'], ['city', 'City'], ['birthday', 'Birthday'],
    ['emC', 'Email consent (yes/no)'], ['emAt', 'Email consent date'], ['emSrc', 'Email consent source'],
    ['smsC', 'SMS consent (yes/no)'], ['smsAt', 'SMS consent date'], ['smsSrc', 'SMS consent source'],
    ['prop', 'Custom property'], ['', 'Do not import']
  ];
  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  I.norm = norm;
  var has = function (h, words) { return words.some(function (w) { return (' ' + h + ' ').indexOf(' ' + w + ' ') >= 0 || (w.length > 4 && h.indexOf(w) >= 0); }); };
  var CONSENT = ['consent', 'soglas', 'privol', 'opt in', 'optin', 'newsletter', 'novice', 'e novice', 'subscribed', 'prijava', 'pristan', 'marketing', 'accepts marketing', 'status'];
  var DATEW = ['date', 'datum', 'at', 'time', 'cas', 'vrijeme', 'when', 'timestamp'];
  var SRCW = ['source', 'vir', 'izvor', 'channel', 'kanal', 'form', 'obrazec', 'obrazac', 'origin'];
  I.guessField = function (header) {
    var h = norm(header);
    if (!h) return '';
    var sms = has(h, ['sms']);
    var consentish = has(h, CONSENT) || sms;
    if (consentish && has(h, DATEW)) return sms ? 'smsAt' : 'emAt';
    if (consentish && has(h, SRCW) && (has(h, CONSENT) || sms)) return sms ? 'smsSrc' : 'emSrc';
    if (sms && !has(h, ['phone', 'telefon', 'mobile', 'mobitel', 'gsm', 'number', 'stevilka', 'broj'])) return 'smsC';
    if (has(h, ['email', 'e mail', 'mail', 'e posta', 'eposta', 'e naslov', 'e adresa', 'elektronska posta'])) return has(h, CONSENT) ? 'emC' : 'email';
    if (has(h, CONSENT)) return 'emC';
    if (h === 'name' || h === 'full name' || h === 'ime in priimek' || h === 'ime i prezime' || h === 'naziv' || h === 'kupec' || h === 'kupac') return 'name';
    if (has(h, ['first name', 'firstname', 'first', 'given name', 'ime', 'forename'])) return 'first';
    if (has(h, ['last name', 'lastname', 'surname', 'family name', 'priimek', 'prezime'])) return 'last';
    if (has(h, ['phone', 'telefon', 'tel', 'mobile', 'mobitel', 'gsm', 'mobilni', 'mobilna'])) return 'phone';
    if (has(h, ['country', 'drzava', 'zemlja', 'country code'])) return 'country';
    if (has(h, ['language', 'lang', 'jezik', 'locale'])) return 'lang';
    if (has(h, ['city', 'mesto', 'kraj', 'grad', 'town', 'posta'])) return 'city';
    if (has(h, ['birthday', 'birth', 'rojstni', 'rojstva', 'rodenja', 'dob', 'rojen'])) return 'birthday';
    if (has(h, SRCW)) return 'emSrc';
    return 'prop';
  };
  I.guess = function (headers) {
    var used = {}, out = headers.map(function (h) { return I.guessField(h); });
    // a field may be picked once; later duplicates become custom properties
    return out.map(function (f) { if (!f || f === 'prop') return f; if (used[f]) return 'prop'; used[f] = 1; return f; });
  };

  // ── Value parsers ──────────────────────────────────────────────────────
  var YES = ['yes', 'y', 'da', 'true', '1', 'x', 'subscribed', 'prijavljen', 'prijavljena', 'opt in', 'optin', 'granted', 'soglasam', 'soglasje', 'privola', 'ok', 'on', 'confirmed', 'potrjeno', 'potvrdeno', 'double opt in'];
  var NO = ['no', 'n', 'ne', 'false', '0', 'never', 'none', 'off', 'not subscribed', 'nikoli'];
  var UNSUB = ['unsubscribed', 'odjavljen', 'odjavljena', 'odjava', 'opt out', 'optout', 'withdrawn', 'preklicano', 'opozvano', 'odjavljeno', 'revoked'];
  // → 'yes' | 'no' | 'unsub' | '' (empty) | null (not understood)
  I.parseConsent = function (v) {
    var s = norm(v);
    if (!s) return '';
    if (UNSUB.indexOf(s) >= 0) return 'unsub';
    if (YES.indexOf(s) >= 0) return 'yes';
    if (NO.indexOf(s) >= 0) return 'no';
    return null;
  };
  // "15. 10. 2026", "15.10.2026 14:05", "2026-10-15", "2026-10-15T14:05:00Z", "15/10/2026" (day first, EU) → ms or null
  I.parseDate = function (v) {
    var s = String(v || '').trim(), m;
    if (!s) return null;
    var hm = function (str) { var t = /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*$/.exec(str); return t ? [+t[1], +t[2], +(t[3] || 0)] : [0, 0, 0]; };
    var mk = function (y, mo, d, t) {
      if (y < 100) y += 2000;
      var dt = new Date(y, mo - 1, d, t[0], t[1], t[2]);
      return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && t[0] < 24 && t[1] < 60 ? dt.getTime() : null;
    };
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s))) {
      if (m[7]) { var iso = Date.parse(s.replace(' ', 'T')); return isFinite(iso) ? iso : null; }
      return mk(+m[1], +m[2], +m[3], m[4] ? [+m[4], +m[5], +(m[6] || 0)] : [0, 0, 0]);
    }
    if ((m = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})\.?(?:[\s,T]+(.+))?$/.exec(s))) return mk(+m[3], +m[2], +m[1], m[4] ? hm(m[4]) : [0, 0, 0]);
    return null;
  };
  I.ymd = function (ms) { var d = new Date(ms); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  I.parseCountry = function (v) {
    var s = norm(v);
    if (!s) return '';
    if (['si', 'svn', 'slo', 'slovenia', 'slovenija', 'slovenska', '386'].indexOf(s) >= 0) return 'SI';
    if (['hr', 'hrv', 'cro', 'croatia', 'hrvaska', 'hrvatska', '385'].indexOf(s) >= 0) return 'HR';
    return null;
  };
  I.parseLang = function (v) {
    var s = norm(v);
    if (!s) return '';
    if (/^(sl|slv|slo|si|sl si|slovenian|slovenscina|slovenski)$/.test(s)) return 'sl';
    if (/^(hr|hrv|cro|hr hr|croatian|hrvascina|hrvatski)$/.test(s)) return 'hr';
    if (/^(en|eng|english|anglescina|engleski|en gb|en us)$/.test(s)) return 'en';
    return null;
  };
  // → { phone: '+386 41 234 567' style (digits grouped), country: 'SI'|'HR'|'' } or null when it is not a phone number
  I.parsePhone = function (v, country) {
    var s = String(v || '').trim();
    if (!s) return { phone: '', country: '' };
    var d = s.replace(/[\s().\/-]/g, '');
    if (/^00/.test(d)) d = '+' + d.slice(2);
    if (/^0\d{7,10}$/.test(d)) d = (country === 'HR' ? '+385' : '+386') + d.slice(1);
    if (/^(386|385)\d{7,10}$/.test(d)) d = '+' + d;
    if (!/^\+\d{8,15}$/.test(d)) return null;
    var cc = /^\+386/.test(d) ? 'SI' : /^\+385/.test(d) ? 'HR' : '';
    var pre = /^\+38[56]/.test(d) ? d.slice(0, 4) : d.slice(0, 3), rest = d.slice(pre.length);
    var grouped = rest.length > 6 ? rest.slice(0, 2) + ' ' + rest.slice(2, 5) + ' ' + rest.slice(5) : rest;
    return { phone: pre + ' ' + grouped, country: cc };
  };
  I.validEmail = function (s) { return /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[a-z]{2,}$/i.test(String(s || '')); };

  // ── The plan (dry run) ─────────────────────────────────────────────────
  // rows: arrays of cells; map: array (per column) of field keys; opt: {
  //   existing: function(emailLower) → profile or null, now: ms, file: 'name.csv',
  //   defaultCountry: 'SI', defaultSource: '' (used when the source column is empty),
  //   missingProof: 'without' (import without consent — default) | 'importDate' (consent at import time, marked in source),
  //   update: true (update existing profiles) }
  // → { create: [rec], update: [rec], skip: [{ line, email, reason }], notes: [{ line, email, note }], stats }
  I.plan = function (headers, rows, map, opt) {
    opt = opt || {};
    var now = opt.now || Date.now(), seen = {}, out = { create: [], update: [], skip: [], notes: [], stats: { emYes: 0, smsYes: 0, noProof: 0, unsub: 0 } };
    var file = opt.file || 'CSV import', fallbackSrc = (opt.defaultSource || '').trim();
    var col = function (key) { return map.indexOf(key); };
    var get = function (r, key) { var i = col(key); return i >= 0 ? r[i] : ''; };
    if (col('email') < 0) { out.error = 'Map one column to Email — it is how profiles are matched.'; return out; }
    rows.forEach(function (r, k) {
      var line = k + 2, email = get(r, 'email').trim().toLowerCase(), notes = [];
      var note = function (t) { notes.push(t); };
      var skip = function (why) { out.skip.push({ line: line, email: email || '(empty)', reason: why }); };
      if (!email) return skip('No email address');
      if (!I.validEmail(email)) return skip('Not a valid email address');
      if (seen[email]) return skip('Duplicate of line ' + seen[email] + ' in this file');
      seen[email] = line;
      var ex = opt.existing ? opt.existing(email) : null;
      if (ex && opt.update === false) return skip('Already a profile (updating is turned off)');
      var rec = { line: line, email: email, profile: ex || null, set: {}, props: {}, em: null, sms: null };
      // names
      var first = get(r, 'first'), last = get(r, 'last');
      if (col('name') >= 0 && !first && !last) { var parts = get(r, 'name').trim().split(/\s+/); first = parts.shift() || ''; last = parts.join(' '); }
      if (first) rec.set.first = first;
      if (last) rec.set.last = last;
      // country, phone, language
      var cRaw = get(r, 'country'), country = I.parseCountry(cRaw);
      if (country === null) { note('Country "' + cRaw + '" is not SI or HR — kept as ' + (ex ? ex.country : opt.defaultCountry || 'SI')); country = ''; }
      var ph = I.parsePhone(get(r, 'phone'), country || (ex && ex.country) || opt.defaultCountry);
      if (ph === null) { note('Phone "' + get(r, 'phone') + '" not understood — left out'); ph = { phone: '', country: '' }; }
      if (!country && ph.country) country = ph.country;
      if (country) rec.set.country = country;
      else if (!ex) rec.set.country = opt.defaultCountry || 'SI';
      if (ph.phone) rec.set.phone = ph.phone;
      var lRaw = get(r, 'lang'), lang = I.parseLang(lRaw);
      if (lang === null) { note('Language "' + lRaw + '" not understood'); lang = ''; }
      if (lang) rec.set.lang = lang;
      else if (!ex) rec.set.lang = (rec.set.country === 'HR' ? 'hr' : 'sl');
      if (get(r, 'city')) rec.set.city = get(r, 'city');
      var bRaw = get(r, 'birthday');
      if (bRaw) { var bd = I.parseDate(bRaw); if (bd && bd < now) rec.set.birthday = I.ymd(bd); else note('Birthday "' + bRaw + '" not understood'); }
      map.forEach(function (f, i) { if (f === 'prop' && r[i] !== '') { var key = norm(headers[i]).replace(/ /g, '_') || 'column_' + (i + 1); rec.props[key] = /^\d+$/.test(r[i]) ? +r[i] : r[i]; } });
      // consent, per channel
      var phoneAfter = rec.set.phone || (ex && ex.phone) || '';
      ['em', 'sms'].forEach(function (ch) {
        var cKey = ch === 'em' ? 'emC' : 'smsC', label = ch === 'em' ? 'Email' : 'SMS';
        if (col(cKey) < 0) return;
        var raw = get(r, cKey), val = I.parseConsent(raw);
        if (val === null) { note(label + ' consent "' + raw + '" not understood — left unchanged'); return; }
        var cur = ex ? ex[ch] : null;
        if (val === 'unsub') {
          // an explicit withdrawal is always applied (new profiles keep it on record)
          if (!cur || cur.s === 'subscribed') { rec[ch] = { s: 'unsubscribed', at: I.parseDate(get(r, ch + 'At')) || now, src: get(r, ch + 'Src') || 'Unsubscribed (' + file + ')' }; out.stats.unsub++; }
          return;
        }
        if (val !== 'yes') { if (!ex) rec[ch] = { s: 'never', at: now, src: '' }; return; }
        if (ch === 'sms' && !phoneAfter) { note('SMS consent without a phone number — not subscribed to SMS'); if (!ex) rec.sms = { s: 'never', at: now, src: '' }; return; }
        var atRaw = get(r, ch + 'At'), at = I.parseDate(atRaw), src = get(r, ch + 'Src') || fallbackSrc;
        if (atRaw && at === null) note(label + ' consent date "' + atRaw + '" not understood');
        if (at && at > now + DAY) { note(label + ' consent date is in the future — not used'); at = null; }
        if (!at || !src) {
          if (opt.missingProof === 'importDate') { at = at || now; src = (src || 'Consent not documented') + ' · recorded at import (' + file + ')'; note(label + ' consent without ' + (!atRaw ? 'a date' : 'a source') + ' — recorded with the import date; keep proof of consent'); }
          else { out.stats.noProof++; note(label + ' consent has no ' + (!at ? 'date' : 'source') + ' — imported without ' + label.toLowerCase() + ' marketing consent (GDPR Art. 7(1): consent must be provable)'); if (!ex) rec[ch] = { s: 'never', at: now, src: '' }; return; }
        }
        if (ex && ex.sup) { note('Profile is suppressed (' + ex.sup.r + ') — consent not changed'); return; }
        if (cur && cur.s === 'unsubscribed' && cur.at >= at) { note(label + ': unsubscribed on ' + I.ymd(cur.at) + ', after the consent in the file — stays unsubscribed (GDPR Art. 7(3))'); return; }
        if (cur && cur.s === 'subscribed') { if (!cur.src) rec[ch] = { s: 'subscribed', at: Math.min(cur.at, at), src: src }; return; }
        rec[ch] = { s: 'subscribed', at: at, src: src };
        out.stats[ch === 'em' ? 'emYes' : 'smsYes']++;
      });
      if (!ex && !rec.em) rec.em = { s: 'never', at: now, src: '' };
      if (!ex && !rec.sms) rec.sms = { s: 'never', at: now, src: '' };
      if (ex) {
        var changes = Object.keys(rec.set).filter(function (k) { return String(ex[k] || '') !== String(rec.set[k]); });
        Object.keys(rec.props).forEach(function (k) { if (!ex.props || String(ex.props[k]) !== String(rec.props[k])) changes.push(k); });
        if (rec.em) changes.push('email consent'); if (rec.sms) changes.push('SMS consent');
        rec.changes = changes;
        if (!changes.length) { notes.forEach(function (t) { out.notes.push({ line: line, email: email, note: t }); }); return skip('Already a profile, nothing new'); }
        out.update.push(rec);
      } else out.create.push(rec);
      notes.forEach(function (t) { out.notes.push({ line: line, email: email, note: t }); });
    });
    return out;
  };

  I.SAMPLE = [
    ['email', 'ime', 'priimek', 'telefon', 'drzava', 'jezik', 'mesto', 'soglasje_email', 'datum_soglasja', 'vir_soglasja', 'soglasje_sms', 'datum_soglasja_sms', 'vir_soglasja_sms'],
    ['ana.primer@example.si', 'Ana', 'Primer', '041 000 101', 'SI', 'sl', 'Ljubljana', 'da', '3. 3. 2025', 'Spletna blagajna', 'da', '3. 3. 2025', 'Spletna blagajna'],
    ['marko.uzorak@example.hr', 'Marko', 'Uzorak', '+385 91 000 202', 'HR', 'hr', 'Zagreb', 'da', '12.09.2024 14:20', 'Tablica u trgovini', 'ne', '', ''],
    ['eva.test@example.si', 'Eva', 'Test', '', 'Slovenija', '', 'Maribor', 'da', '', '', '', '', '']
  ];

  root.AM = root.AM || {};
  root.AM.Import = I;
  if (typeof module !== 'undefined' && module.exports) module.exports = I;
})(typeof window !== 'undefined' ? window : globalThis);
