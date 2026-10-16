// Number, money and date formats for the public site. Slovenian and Croatian: "1.234,50 €", "15. 10. 2026" (Croatian
// with a closing dot: "15. 10. 2026."); English: "€1,234.50", "15 October 2026". Used by the build (Node) and copied
// into assets/site.js for the calculator, so both give the same text.
export const NBSP = ' ';

export function num(n, lang, decimals) {
  const d = decimals === undefined ? (Number.isInteger(n) ? 0 : 2) : decimals;
  const neg = n < 0, s = Math.abs(n).toFixed(d);
  const [int, frac] = s.split('.');
  const group = lang === 'en' ? ',' : '.', dec = lang === 'en' ? '.' : ',';
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return (neg ? '−' : '') + g + (frac ? dec + frac : '');
}

/** 1490 → "1.490 €" (sl, hr) or "€1,490" (en) */
export function eur(n, lang, decimals) {
  return lang === 'en' ? '€' + num(n, lang, decimals) : num(n, lang, decimals) + NBSP + '€';
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-10-15' → "15. 10. 2026" (sl), "15. 10. 2026." (hr), "15 October 2026" (en) */
export function date(iso, lang) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  if (lang === 'en') return d + ' ' + EN_MONTHS[m - 1] + ' ' + y;
  return d + '.' + NBSP + m + '.' + NBSP + y + (lang === 'hr' ? '.' : '');
}

/** Slovenian plural: 1 dan, 2 dneva, 3–4 dnevi, 5+ dni (by the last two digits) */
export function plural(n, lang, forms) {
  if (lang === 'sl') { const h = n % 100; return h === 1 ? forms[0] : h === 2 ? forms[1] : h === 3 || h === 4 ? forms[2] : forms[3]; }
  if (lang === 'hr') { const t = n % 10, h = n % 100; return t === 1 && h !== 11 ? forms[0] : t >= 2 && t <= 4 && (h < 12 || h > 14) ? forms[1] : forms[2]; }
  return n === 1 ? forms[0] : forms[1];
}

/** whole days from `fromIso` until `toIso` (both 'YYYY-MM-DD'), never below 0 */
export function daysUntil(fromIso, toIso) {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 864e5));
}
