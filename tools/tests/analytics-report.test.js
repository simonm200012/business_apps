// Tests for site/analytics/report.js (monthly report words, formats, PDF definition and the .eml file).
// Run: node tools/tests/analytics-report.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '../../site/analytics/report.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

function model(o) {
  return Object.assign({
    y: 2026, m: 9, mtd: false, a: '2026-10-01', b: '2026-10-31', prev: ['2026-09-01', '2026-09-30'], ly: ['2025-10-01', '2025-10-31'],
    pmMonth: { y: 2026, m: 8 }, lyMonth: { y: 2025, m: 9 }, generated: '2026-11-02',
    scope: { co: 'all', locNames: null, ch: null, cat: null },
    kpis: [
      { k: 'rev', t: 'eur', pp: false, inv: false, v: 1234567, p: 1100000, l: 1000000, tg: 1300000 },
      { k: 'gm', t: 'pct', pp: true, inv: false, v: 0.605, p: 0.6, l: 0.59, tg: 0.61 },
      { k: 'rr', t: 'pct', pp: true, inv: true, v: 0.042, p: 0.04, l: 0.045, tg: NaN },
      { k: 'spend', t: 'eur', pp: false, inv: true, v: 50000, p: 40000, l: NaN, tg: NaN }
    ],
    rankKey: 'att', top: [{ name: 'Zagreb', act: 200000, yoy: 0.1, t: 180000, att: 1.111 }], bottom: [{ name: 'Novo mesto', act: 50000, yoy: -0.05, t: 60000, att: 0.833 }],
    cats: [{ id: 'frames', rev: 500000, share: 0.405, yoy: 0.02, gm: 0.62 }, { id: 'sunglasses', rev: 300000, share: 0.243, yoy: 0.3, gm: 0.55 }],
    catTot: { rev: 1234567, yoy: 0.23, gm: 0.605 },
    mk: [{ id: 'google-ads', spend: 30000, rev: 120000, orders: 900 }, { id: 'meta', spend: 20000, rev: 50000, orders: 400 }, { id: 'organic', spend: 0, rev: 80000, orders: 700 }],
    mkTot: { spend: 50000, rev: 250000, orders: 2000 },
    alerts: [{ sev: 'high', tr: { t: 'day', dir: -1, p: 0.45, wd: 1 }, lp: { k: 'loc', loc: 'Koper' }, d0: '2026-10-12', d1: '2026-10-12' },
      { sev: 'medium', tr: { t: 'roas', x: 1.2, m: 3.4 }, lp: { k: 'roas', loc: 'si.shop.example', src: 'meta' }, d0: '2026-10-05', d1: '2026-10-11' }],
    growth: 12
  }, o || {});
}

t('Slovenian number and date formats in every language', () => {
  assert.strictEqual(R.F.eur(1234567), '1.234.567 €');
  assert.strictEqual(R.F.eur(-1234.4), '−1.234 €');
  assert.strictEqual(R.F.eur(1234), '1.234 €'); // four digits are grouped too
  assert.strictEqual(R.F.pct(0.1234), '12,3 %');
  assert.strictEqual(R.F.x(3.456), '3,46×');
  assert.strictEqual(R.dmy('2026-10-05'), '5. 10. 2026');
  assert.strictEqual(R.dmy('2026-10-05', false), '5. 10.');
  assert.strictEqual(R.range('2026-10-01', '2026-10-31'), '1. 10. – 31. 10. 2026');
  assert.strictEqual(R.range('2025-12-29', '2026-01-04'), '29. 12. 2025 – 4. 1. 2026');
  assert.strictEqual(R.signedPct(-0.031), '−3,1 %');
  assert.strictEqual(R.ppTxt('sl', 0.004), '+0,4 o. t.');
  assert.strictEqual(R.ppTxt('hr', -0.012), '−1,2 p. b.');
});

t('month titles and names per language', () => {
  assert.strictEqual(R.monthTitle('sl', 2026, 9), 'Oktober 2026');
  assert.strictEqual(R.monthTitle('hr', 2026, 9), 'Listopad 2026');
  assert.strictEqual(R.monthTitle('en', 2026, 9), 'October 2026');
  assert.strictEqual(R.monthName('sl', 2026, 0), 'januar 2026');
  assert.strictEqual(R.catName('sl', 'contact-lenses'), 'Kontaktne leče');
  assert.strictEqual(R.catName('hr', 'sunglasses'), 'Sunčane naočale');
  assert.strictEqual(R.monthTitle('de', 2026, 9), 'October 2026'); // unknown language falls back to English
});

t('scope line', () => {
  assert.strictEqual(R.scopeText({ co: 'all' }, 'sl'), 'Vse lokacije · Vsi kanali · Vse kategorije');
  assert.strictEqual(R.scopeText({ co: 'HR' }, 'hr'), 'Hrvatska · sve lokacije · Svi kanali · Sve kategorije');
  assert.strictEqual(R.scopeText({ co: 'all', locNames: ['Koper', 'Maribor'], ch: 'eshop', cat: 'frames' }, 'sl'), 'Koper, Maribor · Spletna trgovina · Okvirji');
  assert.strictEqual(R.scopeText({ co: 'all', locNames: ['a', 'b', 'c', 'd'] }, 'en'), '4 locations · All channels · All categories');
});

t('alert titles and labels in three languages', () => {
  const day = { t: 'day', dir: -1, p: 0.45, wd: 1 };
  assert.strictEqual(R.alertTitle(day, 'en'), 'Revenue drop: 45 % below a typical Mon');
  assert.strictEqual(R.alertTitle(day, 'sl'), 'Padec prihodkov: 45 % pod običajnim dnem (ponedeljek)');
  assert.strictEqual(R.alertTitle(day, 'hr'), 'Pad prihoda: 45 % ispod uobičajenog dana (ponedjeljak)');
  assert.strictEqual(R.alertTitle({ t: 'week', dir: 1, p: 0.3 }, 'sl'), 'Tedenski prihodki višji za 30 % glede na prejšnjih 8 tednov');
  assert.strictEqual(R.alertTitle({ t: 'ret', x: 0.082, m: 0.031 }, 'hr'), 'Skok stope povrata: 8,2 % (uobičajeno 3,1 %)');
  assert.strictEqual(R.alertLabel({ k: 'combo', loc: 'Koper', cat: 'frames', ch: 'eshop' }, 'sl'), 'Koper · Okvirji (Spletna trgovina)');
  assert.strictEqual(R.alertLabel({ k: 'combo', loc: 'Koper', cat: 'frames', ch: 'store' }, 'sl'), 'Koper · Okvirji');
  assert.strictEqual(R.alertLabel({ k: 'cat', cat: 'frames' }, 'hr'), 'Okviri (sve lokacije)');
  assert.strictEqual(R.alertLabel({ k: 'ch', ch: 'mkt' }, 'en'), 'Marketplace channel');
});

t('commentary: English, Slovenian, Croatian', () => {
  const M = model();
  const en = R.commentary(M, 'en'), sl = R.commentary(M, 'sl'), hr = R.commentary(M, 'hr');
  assert.strictEqual(en[0], 'Revenue was 1.234.567 €, up 23,5 % on October 2025 and up 12,2 % on September 2026.');
  assert.strictEqual(sl[0], 'Prihodki so znašali 1.234.567 €, kar je 23,5 % več kot v istem mesecu lani in 12,2 % več kot v prejšnjem mesecu.');
  assert.strictEqual(hr[0], 'Prihod iznosio je 1.234.567 €, što je 23,5 % više nego u istom mjesecu prošle godine i 12,2 % više nego u prethodnom mjesecu.');
  assert.strictEqual(sl[1], 'To je 95 % cilja; do cilja manjka 65.433 €.');
  assert.strictEqual(hr[1], 'To je 95 % cilja; do cilja nedostaje 65.433 €.');
  assert.ok(sl[2].startsWith('Bruto marža se je medletno izboljšala za 1,5 o. t. na 60,5 %'), sl[2]);
  assert.strictEqual(sl[3], 'Najboljša lokacija: Zagreb (111 % cilja); najšibkejša: Novo mesto (83 % cilja).');
  assert.ok(sl[4].startsWith('Največja kategorija: Okvirji (40,5 % prihodkov); najhitrejša rast: Sončna očala (+30,0 % medletno)'), sl[4]);
  assert.ok(hr[5].startsWith('Ukupni ROAS bio je 5,00× uz 50.000 € troškova oglašavanja (Google Ads 4,00×, Meta 2,50×)'), hr[5]);
  assert.strictEqual(sl[6], 'Delež vračil: 4,2 % (−0,3 o. t. glede na lani).');
  assert.strictEqual(sl[7], 'Opazna odstopanja: 2; najizrazitejše: padec prihodkov: 45 % pod običajnim dnem (ponedeljek) – Koper (12. 10. 2026).');
  // acronyms keep their capitals inside a sentence
  const M2 = model({ alerts: [model().alerts[1]] });
  assert.ok(R.commentary(M2, 'en')[7].includes('most notable: ROAS drop: 1,20× vs usual 3,40×'), R.commentary(M2, 'en')[7]);
});

t('commentary: month to date, no last year, no alerts', () => {
  const M = model({ mtd: true, b: '2026-10-15', ly: null, lyMonth: null, alerts: [] });
  M.kpis = M.kpis.map(k => Object.assign({}, k, { l: NaN }));
  const sl = R.commentary(M, 'sl'), en = R.commentary(M, 'en');
  assert.strictEqual(sl[0], 'Prihodki od začetka meseca so znašali 1.234.567 €, kar je 12,2 % več kot v prejšnjem mesecu (enako število dni).');
  assert.strictEqual(en[0], 'Revenue month to date was 1.234.567 €, up 12,2 % on September 2026 (same days).');
  assert.ok(!sl.some(l => l.startsWith('Bruto marža')), 'no margin sentence without last year');
  assert.strictEqual(sl[sl.length - 1], 'Ni bilo neobičajnih dni ali tednov.');
});

t('key figure deltas: good and bad follow the direction of the metric', () => {
  const rr = { k: 'rr', t: 'pct', pp: true, inv: true, v: 0.05 };
  assert.deepStrictEqual(R.kpiDelta(rr, 0.04, 'sl'), { txt: '+1,0 o. t.', cls: 'bad' });
  const rev = { k: 'rev', t: 'eur', v: 110 };
  assert.deepStrictEqual(R.kpiDelta(rev, 100, 'en'), { txt: '+10,0 %', cls: 'good' });
  assert.deepStrictEqual(R.kpiDelta(rev, NaN, 'en'), { txt: '—', cls: 'flat' });
  const spend = { k: 'spend', t: 'eur', inv: true, v: 90 };
  assert.strictEqual(R.kpiDelta(spend, 100, 'hr').cls, 'good');
});

t('PDF definition: A4, translated headings, every key figure, page footer', () => {
  const dd = R.pdfDoc(model(), 'sl');
  assert.strictEqual(dd.pageSize, 'A4');
  const flat = JSON.stringify(dd.content);
  ['POVZETEK', 'KLJUČNI PODATKI', 'NAJBOLJŠE LOKACIJE', 'PRODAJA PO KATEGORIJAH', 'OPAZNA ODSTOPANJA', 'Oktober 2026', 'Prihodki', 'Okvirji', 'Organsko'].forEach(w => assert.ok(flat.includes(w), w));
  const key = dd.content.find(c => c.table && c.table.widths.length === 8);
  assert.strictEqual(key.table.body.length, 1 + model().kpis.length);
  const foot = dd.footer(1, 2);
  assert.strictEqual(foot.columns[1].text, 'Stran 1 od 2');
  assert.ok(R.pdfDoc(model({ mk: null, mkTot: null }), 'hr').content.some(c => c.columns && JSON.stringify(c).includes('U odabranom filtru nema web-trgovine.')));
});

t('e-mail: subject, body and file names per language', () => {
  const sl = R.emailParts(model(), 'sl'), hr = R.emailParts(model({ mtd: true, b: '2026-10-15' }), 'hr');
  assert.strictEqual(sl.subject, 'Mesečno poročilo – oktober 2026 (Clearfigure)');
  assert.strictEqual(sl.pdfName, 'Clearfigure-mesecno-porocilo-2026-10.pdf');
  assert.ok(sl.body.startsWith('Pozdravljeni,\r\n\r\nv prilogi je mesečno poslovno poročilo za oktober 2026 (1. 10. – 31. 10. 2026).'), sl.body.slice(0, 120));
  assert.ok(sl.body.includes('\r\n• Prihodki so znašali'));
  assert.strictEqual(hr.emlName, 'Clearfigure-mjesecno-izvjesce-2026-10-15.eml');
  assert.ok(hr.body.includes('od početka mjeseca do danas'));
});

t('base64 and RFC 2047 headers', () => {
  assert.strictEqual(R.base64(Buffer.from('Man')), 'TWFu');
  assert.strictEqual(R.base64(Buffer.from('Ma')), 'TWE=');
  assert.strictEqual(R.base64(Buffer.from('M')), 'TQ==');
  const big = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 37) % 256));
  assert.strictEqual(R.base64(big), big.toString('base64'));
  assert.strictEqual(R.encodeHeader('Monthly report'), 'Monthly report');
  const h = R.encodeHeader('Mesečno poročilo – oktober 2026 (Clearfigure) – zelo dolga zadeva s šumniki čšž');
  const words = h.split('\r\n ');
  assert.ok(words.length > 1);
  words.forEach(w => { assert.ok(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(w), w); assert.ok(w.length <= 75, w.length); });
  const back = words.map(w => Buffer.from(w.slice(10, -2), 'base64')).reduce((a, b) => Buffer.concat([a, b]));
  assert.strictEqual(back.toString('utf8'), 'Mesečno poročilo – oktober 2026 (Clearfigure) – zelo dolga zadeva s šumniki čšž');
  assert.ok(!/\r|\n/.test(R.encodeHeader('a\r\nBcc: x@y.si').replace(/\r\n /g, '')), 'no header injection');
});

t('recipients: valid addresses only', () => {
  assert.deepStrictEqual(R.parseRecipients('ana@example.si, ivo@example.hr'), { ok: ['ana@example.si', 'ivo@example.hr'], bad: [] });
  assert.deepStrictEqual(R.parseRecipients(''), { ok: [], bad: [] });
  assert.deepStrictEqual(R.parseRecipients('ana@example.si; nope'), { ok: ['ana@example.si'], bad: ['nope'] });
  assert.deepStrictEqual(R.parseRecipients('x@y.si\r\nBcc: z@w.si').bad, ['Bcc:']);
});

t('.eml: headers, text and the PDF attachment decode back', () => {
  const pdf = Buffer.from('%PDF-1.3\nfake pdf bytes čšž\n%%EOF');
  const eml = R.buildEml({ to: ['ana@example.si'], subject: 'Mesečno poročilo – oktober 2026', text: 'Pozdravljeni,\r\n\r\nv prilogi je poročilo.', attachments: [{ filename: 'Clearfigure-mesecno-porocilo-2026-10.pdf', type: 'application/pdf', bytes: pdf }], boundary: 'BND', date: new Date(2026, 9, 15, 9, 5, 0) });
  const [head, body] = eml.split('\r\n\r\n', 2);
  assert.ok(/^To: ana@example\.si$/m.test(head));
  assert.ok(/^Subject: =\?UTF-8\?B\?/m.test(head));
  assert.ok(/^Date: Thu, 15 Oct 2026 09:05:00 [+-]\d{4}$/m.test(head), head);
  assert.ok(/^X-Unsent: 1$/m.test(head));
  assert.ok(head.includes('Content-Type: multipart/mixed; boundary="BND"'));
  const parts = eml.split('--BND');
  assert.strictEqual(parts.length, 4); // preamble, text, pdf, closing "--"
  assert.ok(parts[3].startsWith('--'));
  const dec = p => Buffer.from(p.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64');
  assert.strictEqual(dec(parts[1]).toString('utf8'), 'Pozdravljeni,\r\n\r\nv prilogi je poročilo.');
  assert.ok(parts[2].includes('Content-Disposition: attachment; filename="Clearfigure-mesecno-porocilo-2026-10.pdf"'));
  assert.ok(dec(parts[2]).equals(pdf));
  eml.split('\r\n').forEach(line => assert.ok(line.length <= 998, 'line length'));
  assert.ok(!R.buildEml({ subject: 'x', text: '' }).includes('To:'), 'no To header without recipients');
  assert.ok(!body.includes('\n\n'), 'CRLF line ends only');
});

console.log(n + ' tests passed');
