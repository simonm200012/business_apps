/* Webshop conversion health: revenue at risk per issue and content-page detection (plain functions; tests in
 * tools/tests/webshop-risk.test.js). "At risk" is an estimate in euros for the selected period:
 *   - a browser/OS that converts far below its shop and device: the orders it is missing × that shop and device's average order;
 *   - a landing page with traffic and no sales: its sessions × the shop's usual revenue per session on shop pages;
 *   - a landing page that dropped: the revenue it lost against the comparison period;
 *   - a shop whose conversion fell: the lost conversion × its sessions × its average order.
 * Blog and help pages are content: they are not expected to sell, so they carry no revenue at risk. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WebshopRisk = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const fin = (x) => typeof x === 'number' && isFinite(x);
  // content pages: blog, help, FAQ, guides and news, in English, Slovenian, Croatian and Italian paths
  const CONTENT = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:blog|blogs|help|help-center|pomoc|pomoč|pomoć|faq|pogosta-vprasanja|cesta-pitanja|nasveti|savjeti|vodic|vodič|vodici|guide|guides|guida|magazin|magazine|news|novice|vijesti|notizie|aiuto|assistenza|articles|clanki|članki|clanci|članci)(?:\/|$|\?)/i;
  function isContentPage(page) { return CONTENT.test(String(page || '')); }
  const isSpecial = (page) => page === '(not set)' || page === '(other pages)';
  function filterPages(rows, mode) {
    if (mode === 'shop') return rows.filter((r) => !isContentPage(r.page));
    if (mode === 'content') return rows.filter((r) => isContentPage(r.page));
    return rows;
  }
  // shop → usual revenue per session on its shop pages (no content, no "(not set)" / "(other pages)")
  function shopRps(rows) {
    const m = new Map();
    rows.forEach((r) => {
      if (isContentPage(r.page) || isSpecial(r.page)) return;
      const x = m.get(r.shop) || { s: 0, rev: 0 };
      x.s += r.sessions || 0; x.rev += r.revenue || 0;
      m.set(r.shop, x);
    });
    const out = new Map();
    m.forEach((x, k) => out.set(k, x.s ? x.rev / x.s : null));
    return out;
  }
  function noSaleRisk(row, rps) {
    if (isContentPage(row.page) || isSpecial(row.page) || row.transactions > 0 || !fin(rps)) return 0;
    return Math.max(0, (row.sessions || 0) * rps);
  }
  const dropRisk = (row) => (isContentPage(row.page) ? 0 : Math.max(0, -(row.d_revenue || 0)));
  function browserRisk(row, aov) {
    if ((row.flag !== 'broken' && row.flag !== 'low') || !fin(row.missing) || row.missing <= 0 || !fin(aov)) return 0;
    return row.missing * aov;
  }
  function convDropRisk(sessions, convBefore, convNow, aov) {
    if (![sessions, convBefore, convNow, aov].every(fin) || convNow >= convBefore) return 0;
    return (convBefore - convNow) * sessions * aov;
  }
  // issues [{ key, eur, ... }] → the same key counted once (the larger amount), sorted by euros, with the total
  function rank(issues) {
    const by = new Map();
    issues.forEach((i) => { if (!(i.eur > 0)) return; const o = by.get(i.key); if (!o || i.eur > o.eur) by.set(i.key, i); });
    const list = [...by.values()].sort((a, b) => b.eur - a.eur);
    return { list, total: list.reduce((a, i) => a + i.eur, 0) };
  }
  return { isContentPage, filterPages, shopRps, noSaleRisk, dropRisk, browserRisk, convDropRisk, rank };
});
