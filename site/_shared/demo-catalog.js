/* The apps a branded demo (Studio > Branded demo, public page /d/<slug>) can show: id, name as on the home page, group.
   One list for the editor (site/demo-builder/), the page renderer (_shared/demo-render.js), the private API (worker/demos.js)
   and the public Worker. NEVER = apps that are not offered to a prospect: the owner's own tools and private data (the same
   list as PRIVATE_APPS in worker/access.js, plus the Studio pages, which are not apps for a client). COPIES = apps that have a
   public demo copy (DEMO_APPS in tools/build-public.mjs; tools/tests/branded-demo.test.js checks both lists). */
(function (root) {
  'use strict';
  var APPS = [
    ["billing", "Billing", "finance"],
    ["invoices", "Invoices", "finance"],
    ["cashflow", "Cash forecast", "finance"],
    ["collections", "Collections", "finance"],
    ["budget", "Budget vs actual", "finance"],
    ["recon", "Payment reconciliation", "finance"],
    ["contracts", "Contracts & renewals", "finance"],
    ["crm", "CRM", "sales"],
    ["mail", "Clearfigure Mail", "sales"],
    ["marketing", "Marketing calendar", "sales"],
    ["refill", "Refill & win-back", "sales"],
    ["postbench", "Postbench", "sales"],
    ["erp", "ERP", "operations"],
    ["service", "Service jobs", "operations"],
    ["stores", "Store daily board", "operations"],
    ["parcels", "Parcels & COD", "operations"],
    ["branch-manager", "Branch Manager App", "operations"],
    ["desk", "Desk", "operations"],
    ["convert", "Convert", "operations"],
    ["pisarna-dms", "Pisarna DMS Demo", "operations"],
    ["leave", "Time & leave", "people"],
    ["team-tasks", "Team Tasks", "people"],
    ["onboarding", "Joiners & leavers", "people"],
    ["hub-usage", "Portal usage & speed", "people"],
    ["n8n", "n8n Runs", "people"],
    ["analytics", "Analytics", "insights"],
    ["datacheck", "Data health check", "insights"],
    ["ads", "Ads & Return", "insights"],
    ["margin", "Margin guard", "insights"],
    ["webshop", "Webshop conversion health", "insights"],
    ["cs-quality", "Customer service quality", "insights"],
    ["showcase", "Clearfigure", "studio"],
    ["client-atlas", "ERP & BI Client Atlas", "studio"],
    ["design-compare", "Design Comparison", "studio"],
    ["demo-builder", "Branded demo", "studio"]
  ];
  var NEVER = ['billing', 'invoices', 'desk', 'cashflow', 'client-atlas', 'quotes', 'home', 'showcase', 'design-compare', 'demo-builder'];
  var COPIES = ['collections', 'datacheck', 'cashflow', 'budget'];
  var LANGS = ['en', 'sl', 'hr', 'de'];
  function offered() { return APPS.filter(function (a) { return NEVER.indexOf(a[0]) < 0; }).map(function (a) { return { id: a[0], name: a[1], group: a[2] }; }); }
  var api = { APPS: APPS, NEVER: NEVER, COPIES: COPIES, LANGS: LANGS, offered: offered, ids: function () { return offered().map(function (a) { return a.id; }); },
    name: function (id) { for (var i = 0; i < APPS.length; i++) if (APPS[i][0] === id) return APPS[i][1]; return id; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DEMO_CATALOG = api;
})(typeof window !== 'undefined' ? window : this);
