// Every price on the public site, in EUR, without VAT. This is the ONE place to change them: the build
// (node tools/build-public.mjs) writes them into all three languages (SL, HR, EN) in the right number format.
// Whole euros only; a value of 0 shows as "brezplačno" / "besplatno" / "free".
export default {
  // Data health check (Pregled podatkov)
  datacheck: {
    selfCheck: 0,          // A0: the free online self-check (the demo copy on this site)
    report: 490,           // A1: report + 45-minute call, up to 3 lists / 20.000 rows
    reportCreditDays: 60,  // A1 is credited in full if A2 is ordered within this many days
    cleanupFrom: 1490,     // A2: master-data clean-up, up to 2.000 partners + 2.000 products
    cleanupLarge: 2900     // A2: up to 10.000 partners + 10.000 products
  },
  // Collections (Terjatve in opomini), plan "Osnovni"
  collections: {
    setup: 1200,
    monthly: 79,
    users: 3,              // users included in the monthly fee
    extraUser: 15,         // per extra user per month
    annual: 790,           // annual billing (2 months free)
    showPro: false,        // Pro (149 €/month) stays off the page until bank matching + e-mail sending are sold
    proMonthly: 149
  },
  // Cash forecast, 13 weeks (Napoved likvidnosti)
  cashflow: {
    setup: 1500,
    monthly: 99,
    reviewMonthly: 390     // with a review call every two weeks and a note to the director
  },
  // Bundle Collections + Cash forecast (Denarni tok)
  bundle: {
    setup: 2200,
    monthly: 149
  },
  // Budget vs actual with board pack (Plan in realizacija)
  budget: {
    setup: 2900,
    monthly: 149,
    preparedMonthly: 590   // "we prepare it for you" every month
  },
  // E-invoice flows (step 3)
  einvoice: {
    connectionFrom: 1900,
    readinessBundle: 3490, // check + clean-up + connection
    readinessInsteadOf: 3880,
    supportMonthly: 49
  },
  // Custom apps
  custom: {
    dayRate: 640,
    scoping: 340
  },
  // Founding customers: shown under the products when show is true
  founding: {
    show: true,
    customers: 3,
    setupDiscountPct: 50
  }
};
