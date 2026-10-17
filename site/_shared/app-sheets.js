/* Sales sheets for the Business Apps home page (site/index.html, Microsoft 365 look): one entry per app id.
   short = the "who it's for" line under the name in the list; the rest is the sheet beside it.
   Source of the wording: docs/app-summaries.md. Add an app to the home page and add its entry here
   (tools/tests/home-sheets.test.js fails when one is missing or left over). */
(function (root) {
  'use strict';
  var SHEETS = {
 "billing": {
  "short": "Small service firms and freelancers in Slovenia",
  "what": "Issues invoices and credit notes, runs monthly retainer billing and tracks payments. It handles the numbering and tax exports a Slovenian business needs, and keeps a tamper-evident log. Data is saved in the browser plus a private cloud copy.",
  "who": "Small service firms and freelancers in Slovenia; owner or finance admin.",
  "problem": "Makes invoicing compliant and traceable without a paid accounting suite.",
  "features": [
   "Gap-free invoice numbering and FURS-style data",
   "UPN QR codes and VAT ledger / RP-O exports",
   "Tamper-evident log, retainer billing"
  ],
  "pitch": "Invoicing that already meets the Slovenian tax rules, with a log nobody can quietly edit."
 },
 "invoices": {
  "short": "Any company with many supplier bills",
  "what": "Reads PDF, e-invoice or photo invoices dropped onto the page and pulls out vendor, dates, VAT and totals. It then shows costs by month, category, vendor and person, plus what is unpaid. It exports data for the accountant.",
  "who": "Any company with many supplier bills; finance or office manager.",
  "problem": "Removes manual typing of supplier invoices and shows where money goes.",
  "features": [
   "Drag-and-drop PDF/e-invoice reading",
   "Cost breakdowns (month, category, vendor, person, company)",
   "Duplicate check, vendor templates, \"pay approved invoices\", bank-statement matching, accountant export"
  ],
  "pitch": "Drop your supplier invoices in and see what you spend, what is unpaid and what to send your accountant."
 },
 "cashflow": {
  "short": "Owners and finance leads at SMEs with uneven cash flow",
  "what": "Builds a 13-week cash forecast from open invoices, bills, payroll, taxes and sales pipeline. It warns before cash drops below a set minimum, suggests what would close the gap, and compares scenarios. It can import the user's invoices as CSV.",
  "who": "Owners and finance leads at SMEs with uneven cash flow.",
  "problem": "Shows when cash will run short before it happens.",
  "features": [
   "13-week rolling forecast with minimum-cash warning",
   "Customer payment timing based on real behaviour",
   "Scenario comparison, CSV import"
  ],
  "pitch": "See 13 weeks ahead whether you will run out of cash, and what would fix it."
 },
 "collections": {
  "short": "Credit controllers and finance staff at B2B companies",
  "what": "Shows who owes money, who to call today, and a printable reminder letter with statutory late-payment interest calculated. It tracks promises to pay and payment plans, and measures whether reminders bring money in.",
  "who": "Credit controllers and finance staff at B2B companies.",
  "problem": "Turns chasing unpaid invoices into a daily call list.",
  "features": [
   "Daily call list and printable reminder letter",
   "Late-payment interest calculation",
   "Promises to pay, payment plans, reminder effectiveness"
  ],
  "pitch": "Every morning you get the list of who to call, with the reminder letter ready and interest already worked out."
 },
 "budget": {
  "short": "Finance controllers, CFOs and managers who report to a board",
  "what": "Puts the year's budget next to actual results month by month. It flags variances that need explaining, shows an EBITDA bridge, gives a full-year outlook and makes a printable board pack.",
  "who": "Finance controllers, CFOs and managers who report to a board.",
  "problem": "Makes budget variances visible and ready for a board meeting.",
  "features": [
   "Monthly budget vs actual with variance flags",
   "EBITDA bridge and full-year outlook",
   "Printable board pack"
  ],
  "pitch": "Budget against actuals every month, with the variances already explained and a board pack you can print."
 },
 "recon": {
  "short": "E-commerce finance or accounting staff",
  "what": "Matches each payment-provider payment, refund and payout to shop orders and to the bank. It lists exceptions to work through and exports a closed month for accounting.",
  "who": "E-commerce finance or accounting staff.",
  "problem": "Finds the gaps between shop sales, provider payouts and bank receipts before month-end.",
  "features": [
   "Matching of payments, refunds and payouts to orders and bank lines",
   "Exception queue",
   "Month-close export for accounting"
  ],
  "pitch": "Every shop payment matched to the bank, with the exceptions listed and a clean export for your accountant."
 },
 "contracts": {
  "short": "Office, procurement or operations managers at multi-site firms",
  "what": "Keeps one register of leases, supplier, software and service contracts. It shows notice deadlines, renewal dates, price rises and annual spend so no deadline is missed.",
  "who": "Office, procurement or operations managers at multi-site firms.",
  "problem": "Stops automatic renewals and price rises catching the business unaware.",
  "features": [
   "Single register of contracts",
   "Notice-deadline and renewal alerts",
   "Price-increase tracking and annual spend"
  ],
  "pitch": "One list of every contract with its notice date, so you never miss a cancellation window."
 },
 "crm": {
  "short": "Sales managers and reps at B2B companies",
  "what": "Manages companies, contacts, activities and a deal pipeline board for a B2B sales team, with forecasts and win rates. Changes sync between the user's devices.",
  "who": "Sales managers and reps at B2B companies.",
  "problem": "Keeps deals and contacts in one place with a clear pipeline.",
  "features": [
   "Companies, contacts and activities",
   "Deal pipeline board",
   "Forecast and win-rate figures"
  ],
  "pitch": "A simple sales pipeline with forecasts that follows you from laptop to phone."
 },
 "mail": {
  "short": "Marketing managers at retail or e-commerce companies",
  "what": "Email and SMS marketing: contact profiles, segments, campaigns with a drag-and-drop email editor, automated flows, sign-up forms and revenue reports. Nothing is actually sent.",
  "who": "Marketing managers at retail or e-commerce companies.",
  "problem": "Runs customer messaging and shows what it earns.",
  "features": [
   "Segments and drag-and-drop email editor",
   "Automated flows and sign-up forms",
   "Campaign revenue reports"
  ],
  "pitch": "Segment your customers, build the email, and see what each campaign earned, all in one place."
 },
 "marketing": {
  "short": "Marketing leads running campaigns across several countries",
  "what": "Plans campaigns, promotions and posts per market in one calendar. Next to each item it shows what was spent and earned.",
  "who": "Marketing leads running campaigns across several countries.",
  "problem": "Puts the plan and the money for each campaign side by side.",
  "features": [
   "Calendar per market",
   "Spend and return next to each campaign",
   "Cloud-synced planning"
  ],
  "pitch": "One calendar for every campaign in every market, showing what each one actually earned."
 },
 "refill": {
  "short": "Marketing or CRM leads at optical or subscription retailers",
  "what": "Shows contact-lens customers who will run out soon, per market, and how many can be emailed. It suggests a model for when to reach them and checks whether reminders work.",
  "who": "Marketing or CRM leads at optical or subscription retailers.",
  "problem": "Wins back repeat customers before they buy elsewhere.",
  "features": [
   "Customers due to run out, by market",
   "Count of reachable customers",
   "Reminder effectiveness check"
  ],
  "pitch": "Know which customers are about to run out of lenses and remind them before a competitor does."
 },
 "postbench": {
  "short": "Small business owners or marketing staff who make their own social posts",
  "what": "A design tool for social posts and banners. It turns a customer review into a post, sets size, layout, text, colours, logo and safe zones, and has a month planner and export.",
  "who": "Small business owners or marketing staff who make their own social posts.",
  "problem": "Makes on-brand posts for every platform without a designer.",
  "features": [
   "Templates by size and layout, with safe zones",
   "Review-to-post and caption helpers",
   "Month planner and export"
  ],
  "pitch": "Make every social post and banner for every platform in one place, without a designer."
 },
 "erp": {
  "short": "Operations or finance staff at a multi-shop retailer",
  "what": "A small ERP for an optical retailer: products and stock per location, purchasing, sales orders, invoices and payments. Changes sync between devices.",
  "who": "Operations or finance staff at a multi-shop retailer.",
  "problem": "Keeps stock, orders and payments in one system.",
  "features": [
   "Stock per location",
   "Purchasing and sales orders",
   "Invoices and payments"
  ],
  "pitch": "A simple ERP for a retail chain: stock, purchasing, orders and payments in one system."
 },
 "service": {
  "short": "Field-service companies with technicians and a dispatcher",
  "what": "A technician's phone view with checklist, photos, parts used and customer signature. For the office it offers a dispatch board, due-maintenance list, signed service reports and an invoice-ready list.",
  "who": "Field-service companies with technicians and a dispatcher.",
  "problem": "Replaces paper job sheets and gets finished jobs billed faster.",
  "features": [
   "Technician checklist with photos and signature",
   "Dispatch board and maintenance due list",
   "Invoice-ready list of finished jobs"
  ],
  "pitch": "Technicians close jobs on their phone with a signature, and the office invoices them the same day."
 },
 "stores": {
  "short": "Store managers and area managers in a retail chain",
  "what": "A morning screen for each optics store: yesterday's sales, month-to-date against target, cash check, today's staff, pickups to call, complaints, reviews and head-office tasks.",
  "who": "Store managers and area managers in a retail chain.",
  "problem": "Gives each store one daily to-do and performance view.",
  "features": [
   "Yesterday's sales and month-to-date vs target",
   "Cash check and staff for today",
   "Pickups, complaints, reviews and tasks"
  ],
  "pitch": "Every store manager starts the day with yesterday's numbers and today's to-do list on one screen."
 },
 "parcels": {
  "short": "E-commerce operations or logistics staff shipping cash-on-delivery",
  "what": "Tracks parcels across several carriers (GLS, DPD, national posts, BOX NOW, Poste Italiane), works the stuck ones, and checks that cash-on-delivery money reached the bank.",
  "who": "E-commerce operations or logistics staff shipping cash-on-delivery.",
  "problem": "Finds lost or stuck parcels and missing COD payments.",
  "features": [
   "Multi-carrier tracking view",
   "Stuck-parcel work queue",
   "COD-to-bank check"
  ],
  "pitch": "See every parcel across all your carriers and confirm every cash-on-delivery payment reached the bank."
 },
 "branch-manager": {
  "short": "Managers of a multi-branch service business (e.g. appointments)",
  "what": "A prototype showing bookings, branches and managers side by side, with lifetime and monthly statistics and a booking calendar per branch. The entry page is `Login.dc.html`.",
  "who": "Managers of a multi-branch service business (e.g. appointments).",
  "problem": "Shows bookings and performance across branches in one view.",
  "features": [
   "Bookings, branches and managers in one view",
   "Lifetime and monthly statistics",
   "Booking calendar per branch"
  ],
  "pitch": "One view of every branch's bookings and managers, with a calendar per location."
 },
 "desk": {
  "short": "Office or admin staff who handle requests and bookings by email",
  "what": "Turns Outlook emails into tasks. Users can attach booking links and confirmation PDFs and see what is done and what is left. Data is saved in the browser and the private cloud copy.",
  "who": "Office or admin staff who handle requests and bookings by email.",
  "problem": "Stops requests living only in the inbox.",
  "features": [
   "Drag an email onto the page or paste its text to make a task",
   "Attachments (booking links, PDFs)",
   "Done/left overview and settings"
  ],
  "pitch": "Drag an Outlook email onto the page and it becomes a tracked task, with the confirmation attached."
 },
 "pisarna-dms": {
  "short": "Companies or public-sector offices that manage documents and records",
  "what": "A document-management demo with fictional data. Visitors sign in as a demo user with a shared demo password, and changes stay in the browser.",
  "who": "Companies or public-sector offices that manage documents and records.",
  "problem": "Lets prospects try a document system before buying.",
  "features": [
   "Demo sign-in with fictional users",
   "Document management views",
   "Changes kept in the browser only"
  ],
  "pitch": "Try a document-management system with fake data, sign in and click around."
 },
 "leave": {
  "short": "HR and managers at companies with staff in Slovenia and Croatia",
  "what": "Handles leave requests and approvals, with a team calendar that includes Slovenian and Croatian public holidays. It shows everyone's remaining days, lets people clock in on the phone and produces a monthly working-time record.",
  "who": "HR and managers at companies with staff in Slovenia and Croatia.",
  "problem": "Replaces scattered leave emails and spreadsheets.",
  "features": [
   "Leave requests and approvals",
   "Team calendar with SI/HR holidays",
   "Phone clock-in and monthly time record"
  ],
  "pitch": "Leave requests, approvals and clock-in in one app, with Slovenian and Croatian holidays built in."
 },
 "team-tasks": {
  "short": "Software or product teams",
  "what": "A Linear-style issue tracker with lists and boards grouped by status, cycles, projects, an inbox, a ⌘K command menu and keyboard shortcuts.",
  "who": "Software or product teams.",
  "problem": "Tracks team work in a fast, keyboard-first tool.",
  "features": [
   "Lists and boards by status, cycles and projects",
   "Inbox and ⌘K command menu",
   "Keyboard shortcuts"
  ],
  "pitch": "A fast, keyboard-driven task tracker for your team, with cycles and boards."
 },
 "onboarding": {
  "short": "HR and IT admins",
  "what": "Checklists for new hires, moves and leavers: accounts, licences, attendance cards, keys and equipment. It flags overdue tasks by team and makes sure nothing is missed on the last day.",
  "who": "HR and IT admins.",
  "problem": "Stops access and equipment being forgotten when people start or leave.",
  "features": [
   "Checklists for joiners, movers and leavers",
   "Overdue tasks by team",
   "Last-day checks (accounts, keys, equipment)"
  ],
  "pitch": "No one leaves or joins with an account still open or a key not returned."
 },
 "hub-usage": {
  "short": "IT managers running internal tools",
  "what": "Shows who uses which apps on an internal apps portal, how fast and reliable each one is, which apps could be retired, and what the cloud costs.",
  "who": "IT managers running internal tools.",
  "problem": "Shows which internal apps are used, slow or costly.",
  "features": [
   "Usage by person and app",
   "Speed and reliability per app",
   "Retirement candidates and cloud cost"
  ],
  "pitch": "See which internal apps people really use, which are slow, and which you could retire."
 },
 "n8n": {
  "short": "Ops or IT staff who run n8n automations",
  "what": "Shows every n8n automation workflow: health, scheduled runs per day, missed and failed runs, and when each was last deployed. The live version reads a run tracker.",
  "who": "Ops or IT staff who run n8n automations.",
  "problem": "Shows at a glance whether automations are running.",
  "features": [
   "Health and scheduled runs per day",
   "Missed and failed run alerts",
   "Last-deployed date per workflow"
  ],
  "pitch": "See every automation's health and any missed run in one screen."
 },
 "analytics": {
  "short": "Management and analysts at retail or e-commerce companies",
  "what": "A dashboard for sales, stores, the e-commerce funnel, marketing return on ad spend, customer cohorts and products, with filters and comparisons.",
  "who": "Management and analysts at retail or e-commerce companies.",
  "problem": "Puts the main business numbers in one place with filters.",
  "features": [
   "Sales, store and funnel dashboards",
   "Marketing return and customer cohorts",
   "Filters and period comparisons"
  ],
  "pitch": "One dashboard for sales, stores, the webshop funnel and marketing return, with filters you can change live."
 },
 "quotes": {
  "short": "Freelancers and small agencies that send quotes and then have to write the invoice again",
  "what": "You build a quote with items, discounts and VAT while a live preview shows the finished page. The client opens a link, reads it and presses Accept or Decline. When a quote is accepted, one click makes the invoice draft in Billing with the same items, discount and VAT.",
  "who": "Studios, consultants and trades that quote a job before they bill it.",
  "problem": "Stops quotes from being retyped as invoices, and shows which ones are still open, accepted or expired.",
  "features": [
   "Status tabs and totals: what is still open, what was accepted this month, how many quotes are won",
   "Exact totals with line and overall discounts, and print or save as PDF",
   "A client page to accept or decline, then Accepted to a Billing invoice draft in one click, never twice"
  ],
  "pitch": "Send a quote, get a yes, and the invoice is already waiting in Billing."
 },
 "convert": {
  "short": "Anyone who handles contracts, statements and exports and needs them in another format",
  "what": "You drop in a PDF, Word, Excel, CSV or XML file and get it back in the format you need: Word to PDF, PDF to Word, tables from a PDF into Excel, Excel or CSV to XML and back, plus merging and splitting PDFs. Everything happens in your browser, so the files are never uploaded.",
  "who": "Office staff, finance and operations teams, and anyone who gets documents in the wrong format.",
  "problem": "Stops you sending contracts and bank statements to an online converter just to change the file type.",
  "features": [
   "PDF, Word, Excel, CSV, XML, pictures and text, in the combinations people actually need",
   "PDF tables into Excel, with real numbers and a preview of the first rows",
   "Merge and split PDFs; nothing leaves your computer"
  ],
  "pitch": "Your contracts and statements never leave your computer, unlike online converters."
 },
 "datacheck": {
  "short": "Anyone who maintains customer or supplier master data, such as finance, sales ops or data teams",
  "what": "You drop in a customer, supplier or product list and it finds what is broken: invalid VAT numbers and IBANs, duplicates and missing fields. It can fix them in one click and gives back a clean file and a report. Files never leave the browser.",
  "who": "Anyone who maintains customer or supplier master data, such as finance, sales ops or data teams.",
  "problem": "Cleans messy lists before they cause failed invoices or bank payments.",
  "features": [
   "Checks VAT numbers (VIES) and IBANs, duplicates and missing fields",
   "One-click fixes",
   "Clean file and report download; files stay in the browser"
  ],
  "pitch": "Drop in your customer list and get back a clean file with bad VAT numbers and IBANs fixed."
 },
 "ads": {
  "short": "Marketing managers spending on paid ads across markets",
  "what": "Compares Google Ads and Meta spend with GA4 revenue and store bookings. It shows return per market, every campaign, cost per booking, budget pacing and wasted spend.",
  "who": "Marketing managers spending on paid ads across markets.",
  "problem": "Shows which ad spend really brings revenue.",
  "features": [
   "Spend vs revenue and bookings per market",
   "Campaign-level cost per booking",
   "Budget pacing and wasted-spend view"
  ],
  "pitch": "See which ad spend really brings bookings and which is wasted, market by market."
 },
 "margin": {
  "short": "Retail or e-commerce finance and pricing managers",
  "what": "Shows which discount codes, price lists, brands and shops lose margin, and lists yesterday's sales that were sold below cost.",
  "who": "Retail or e-commerce finance and pricing managers.",
  "problem": "Catches discounts and sales that lose money.",
  "features": [
   "Margin by discount code, price list, brand and shop",
   "Yesterday's negative-margin sales"
  ],
  "pitch": "Find the discount codes and sales that quietly lose you money, every day."
 },
 "webshop": {
  "short": "E-commerce managers and marketing analysts",
  "what": "Shows where shoppers drop off across five webshops, by shop, device, category and landing page. It also flags tracking that looks broken.",
  "who": "E-commerce managers and marketing analysts.",
  "problem": "Shows where the shop loses buyers and whether the tracking can be trusted.",
  "features": [
   "Drop-off by shop, device, category and landing page",
   "Broken-tracking warnings"
  ],
  "pitch": "See exactly where shoppers drop off on each webshop, and whether your tracking is broken."
 },
 "cs-quality": {
  "short": "Customer service managers and directors",
  "what": "Shows customer service measures: NPS, first-answer times, SLA compliance, call volumes and how much the AI chatbot handles, by market and queue.",
  "who": "Customer service managers and directors.",
  "problem": "Tracks service levels and the chatbot's impact in one view.",
  "features": [
   "NPS and first-answer time",
   "SLA and call volume by market and queue",
   "Chatbot share of handled contacts"
  ],
  "pitch": "One view of your service levels, NPS and how much work the chatbot takes off your team."
 },
 "showcase": {
  "short": "Prospective clients (the sales page for the consultancy)",
  "what": "The company's own showcase site. It presents data warehousing, Power BI, analytics, predictions, automation and business apps, with live product mock-ups and links to the demos.",
  "who": "Prospective clients (the sales page for the consultancy).",
  "problem": "Shows what the firm offers and lets prospects click into demos.",
  "features": [
   "Service sections (data, Power BI, automation, apps)",
   "Live product mock-ups",
   "Links to demos, FAQ"
  ],
  "pitch": "Here is what we build, and you can click into live examples right now."
 },
 "client-atlas": {
  "short": "The consultancy's own business development (owner)",
  "what": "A sales-prospecting tool for finding paying clients for ERP, CRM, Power BI and data work, from Slovenia out to Europe. It has filters, a market map, leads, deadlines that create projects, outreach drafts and a search kit. Pipeline progress is saved in the private cloud copy.",
  "who": "The consultancy's own business development (owner).",
  "problem": "Organises where and how to find new consulting clients.",
  "features": [
   "Market map and filtered leads",
   "Project-triggering deadlines",
   "Outreach drafts and search kit"
  ],
  "pitch": "Not a prospect-facing demo: this is our own tool for finding consulting clients."
 },
 "design-compare": {
  "short": "Anyone choosing a look for their apps",
  "what": "Shows the real styles of these apps and the six home page styles side by side, in light and dark. Clients mark their favourites and send the result back as a link.",
  "who": "A client or team deciding how their apps should look; the person running the workshop.",
  "problem": "Ends endless taste debates: the choice is made on real screens, not on descriptions.",
  "features": [
   "Real app styles and home page styles, light and dark",
   "Each person marks their favourites",
   "The result travels as a link"
  ],
  "pitch": "Let the client see and vote on the real thing in ten minutes, then we build exactly that."
 }
};
  if (typeof module !== 'undefined' && module.exports) module.exports = SHEETS;
  else root.APP_SHEETS = SHEETS;
})(typeof window !== 'undefined' ? window : this);
