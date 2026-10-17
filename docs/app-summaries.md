# Business Apps: what each app is for

Draft for Simon to check (17 Oct 2026). Written by a reading pass over each app's page and home-page card; most features are from card text, so correct anything that's wrong. Fix this file and the home page cards will use it.

Business Apps home page: 32 apps (design-compare excluded per brief), grouped as on index.html. Built from each card's text and headings in the app HTML; main JS was not read in depth, so features are medium confidence unless noted.

### Billing (`billing/`) — Finance
- **What it does:** Issues invoices and credit notes, runs monthly retainer billing and tracks payments. It handles the numbering and tax exports a Slovenian business needs, and keeps a tamper-evident log. Data is saved in the browser plus a private cloud copy.
- **Who it's for:** Small service firms and freelancers in Slovenia; owner or finance admin.
- **Problem it solves:** Makes invoicing compliant and traceable without a paid accounting suite.
- **Key features:**
  - Gap-free invoice numbering and FURS-style data
  - UPN QR codes and VAT ledger / RP-O exports
  - Tamper-evident log, retainer billing
- **Pitch line:** "Invoicing that already meets the Slovenian tax rules, with a log nobody can quietly edit."
- **Demo or own tool?** Own tool (real data). **Confidence:** medium (card text only; no headings checked).

### Invoices (`invoices/`) — Finance
- **What it does:** Reads PDF, e-invoice or photo invoices dropped onto the page and pulls out vendor, dates, VAT and totals. It then shows costs by month, category, vendor and person, plus what is unpaid. It exports data for the accountant.
- **Who it's for:** Any company with many supplier bills; finance or office manager.
- **Problem it solves:** Removes manual typing of supplier invoices and shows where money goes.
- **Key features:**
  - Drag-and-drop PDF/e-invoice reading
  - Cost breakdowns (month, category, vendor, person, company)
  - Duplicate check, vendor templates, "pay approved invoices", bank-statement matching, accountant export
- **Pitch line:** "Drop your supplier invoices in and see what you spend, what is unpaid and what to send your accountant."
- **Demo or own tool?** Own tool (real data). **Confidence:** high (headings and card verified).

### Cash forecast (`cashflow/`) — Finance
- **What it does:** Builds a 13-week cash forecast from open invoices, bills, payroll, taxes and sales pipeline. It warns before cash drops below a set minimum, suggests what would close the gap, and compares scenarios. It can import the user's invoices as CSV.
- **Who it's for:** Owners and finance leads at SMEs with uneven cash flow.
- **Problem it solves:** Shows when cash will run short before it happens.
- **Key features:**
  - 13-week rolling forecast with minimum-cash warning
  - Customer payment timing based on real behaviour
  - Scenario comparison, CSV import
- **Pitch line:** "See 13 weeks ahead whether you will run out of cash, and what would fix it."
- **Demo or own tool?** Own tool (real data, cloud-synced). **Confidence:** medium (card text only).

### Collections (`collections/`) — Finance
- **What it does:** Shows who owes money, who to call today, and a printable reminder letter with statutory late-payment interest calculated. It tracks promises to pay and payment plans, and measures whether reminders bring money in.
- **Who it's for:** Credit controllers and finance staff at B2B companies.
- **Problem it solves:** Turns chasing unpaid invoices into a daily call list.
- **Key features:**
  - Daily call list and printable reminder letter
  - Late-payment interest calculation
  - Promises to pay, payment plans, reminder effectiveness
- **Pitch line:** "Every morning you get the list of who to call, with the reminder letter ready and interest already worked out."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only; marked "New").

### Budget vs actual (`budget/`) — Finance
- **What it does:** Puts the year's budget next to actual results month by month. It flags variances that need explaining, shows an EBITDA bridge, gives a full-year outlook and makes a printable board pack.
- **Who it's for:** Finance controllers, CFOs and managers who report to a board.
- **Problem it solves:** Makes budget variances visible and ready for a board meeting.
- **Key features:**
  - Monthly budget vs actual with variance flags
  - EBITDA bridge and full-year outlook
  - Printable board pack
- **Pitch line:** "Budget against actuals every month, with the variances already explained and a board pack you can print."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only; marked "New").

### Payment reconciliation (`recon/`) — Finance
- **What it does:** Matches each payment-provider payment, refund and payout to shop orders and to the bank. It lists exceptions to work through and exports a closed month for accounting.
- **Who it's for:** E-commerce finance or accounting staff.
- **Problem it solves:** Finds the gaps between shop sales, provider payouts and bank receipts before month-end.
- **Key features:**
  - Matching of payments, refunds and payouts to orders and bank lines
  - Exception queue
  - Month-close export for accounting
- **Pitch line:** "Every shop payment matched to the bank, with the exceptions listed and a clean export for your accountant."
- **Demo or own tool?** Demo with fake data (notes an old and a new design). **Confidence:** medium (card text only).

### Contracts & renewals (`contracts/`) — Finance
- **What it does:** Keeps one register of leases, supplier, software and service contracts. It shows notice deadlines, renewal dates, price rises and annual spend so no deadline is missed.
- **Who it's for:** Office, procurement or operations managers at multi-site firms.
- **Problem it solves:** Stops automatic renewals and price rises catching the business unaware.
- **Key features:**
  - Single register of contracts
  - Notice-deadline and renewal alerts
  - Price-increase tracking and annual spend
- **Pitch line:** "One list of every contract with its notice date, so you never miss a cancellation window."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only).

### CRM (`crm/`) — Sales & marketing
- **What it does:** Manages companies, contacts, activities and a deal pipeline board for a B2B sales team, with forecasts and win rates. Changes sync between the user's devices.
- **Who it's for:** Sales managers and reps at B2B companies.
- **Problem it solves:** Keeps deals and contacts in one place with a clear pipeline.
- **Key features:**
  - Companies, contacts and activities
  - Deal pipeline board
  - Forecast and win-rate figures
- **Pitch line:** "A simple sales pipeline with forecasts that follows you from laptop to phone."
- **Demo or own tool?** Demo with fake data (cloud-synced). **Confidence:** medium (card text only).

### Mail (`mail/`) — Sales & marketing
- **What it does:** Email and SMS marketing: contact profiles, segments, campaigns with a drag-and-drop email editor, automated flows, sign-up forms and revenue reports. Nothing is actually sent.
- **Who it's for:** Marketing managers at retail or e-commerce companies.
- **Problem it solves:** Runs customer messaging and shows what it earns.
- **Key features:**
  - Segments and drag-and-drop email editor
  - Automated flows and sign-up forms
  - Campaign revenue reports
- **Pitch line:** "Segment your customers, build the email, and see what each campaign earned, all in one place."
- **Demo or own tool?** Demo with fake data (nothing is sent). **Confidence:** medium (card text only).

### Marketing calendar (`marketing/`) — Sales & marketing
- **What it does:** Plans campaigns, promotions and posts per market in one calendar. Next to each item it shows what was spent and earned.
- **Who it's for:** Marketing leads running campaigns across several countries.
- **Problem it solves:** Puts the plan and the money for each campaign side by side.
- **Key features:**
  - Calendar per market
  - Spend and return next to each campaign
  - Cloud-synced planning
- **Pitch line:** "One calendar for every campaign in every market, showing what each one actually earned."
- **Demo or own tool?** Demo with fake data (nothing is posted). **Confidence:** medium (card text only).

### Refill & win-back (`refill/`) — Sales & marketing
- **What it does:** Shows contact-lens customers who will run out soon, per market, and how many can be emailed. It suggests a model for when to reach them and checks whether reminders work.
- **Who it's for:** Marketing or CRM leads at optical or subscription retailers.
- **Problem it solves:** Wins back repeat customers before they buy elsewhere.
- **Key features:**
  - Customers due to run out, by market
  - Count of reachable customers
  - Reminder effectiveness check
- **Pitch line:** "Know which customers are about to run out of lenses and remind them before a competitor does."
- **Demo or own tool?** Demo with fake data (totals only). **Confidence:** medium (card text only).

### Postbench (`postbench/`) — Sales & marketing
- **What it does:** A design tool for social posts and banners. It turns a customer review into a post, sets size, layout, text, colours, logo and safe zones, and has a month planner and export.
- **Who it's for:** Small business owners or marketing staff who make their own social posts.
- **Problem it solves:** Makes on-brand posts for every platform without a designer.
- **Key features:**
  - Templates by size and layout, with safe zones
  - Review-to-post and caption helpers
  - Month planner and export
- **Pitch line:** "Make every social post and banner for every platform in one place, without a designer."
- **Demo or own tool?** Own tool (no demo-data label; likely the owner's work tool). **Confidence:** low (card text and headings only; ownership unclear).

### ERP (`erp/`) — Operations
- **What it does:** A small ERP for an optical retailer: products and stock per location, purchasing, sales orders, invoices and payments. Changes sync between devices.
- **Who it's for:** Operations or finance staff at a multi-shop retailer.
- **Problem it solves:** Keeps stock, orders and payments in one system.
- **Key features:**
  - Stock per location
  - Purchasing and sales orders
  - Invoices and payments
- **Pitch line:** "A simple ERP for a retail chain: stock, purchasing, orders and payments in one system."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only).

### Service jobs (`service/`) — Operations
- **What it does:** A technician's phone view with checklist, photos, parts used and customer signature. For the office it offers a dispatch board, due-maintenance list, signed service reports and an invoice-ready list.
- **Who it's for:** Field-service companies with technicians and a dispatcher.
- **Problem it solves:** Replaces paper job sheets and gets finished jobs billed faster.
- **Key features:**
  - Technician checklist with photos and signature
  - Dispatch board and maintenance due list
  - Invoice-ready list of finished jobs
- **Pitch line:** "Technicians close jobs on their phone with a signature, and the office invoices them the same day."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only).

### Store daily board (`stores/`) — Operations
- **What it does:** A morning screen for each optics store: yesterday's sales, month-to-date against target, cash check, today's staff, pickups to call, complaints, reviews and head-office tasks.
- **Who it's for:** Store managers and area managers in a retail chain.
- **Problem it solves:** Gives each store one daily to-do and performance view.
- **Key features:**
  - Yesterday's sales and month-to-date vs target
  - Cash check and staff for today
  - Pickups, complaints, reviews and tasks
- **Pitch line:** "Every store manager starts the day with yesterday's numbers and today's to-do list on one screen."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only).

### Parcels & COD (`parcels/`) — Operations
- **What it does:** Tracks parcels across several carriers (GLS, DPD, national posts, BOX NOW, Poste Italiane), works the stuck ones, and checks that cash-on-delivery money reached the bank.
- **Who it's for:** E-commerce operations or logistics staff shipping cash-on-delivery.
- **Problem it solves:** Finds lost or stuck parcels and missing COD payments.
- **Key features:**
  - Multi-carrier tracking view
  - Stuck-parcel work queue
  - COD-to-bank check
- **Pitch line:** "See every parcel across all your carriers and confirm every cash-on-delivery payment reached the bank."
- **Demo or own tool?** Demo with fake data (nothing sent to carriers). **Confidence:** medium (card text only).

### Branch Manager App (`branch-manager/`) — Operations
- **What it does:** A prototype showing bookings, branches and managers side by side, with lifetime and monthly statistics and a booking calendar per branch. The entry page is `Login.dc.html`.
- **Who it's for:** Managers of a multi-branch service business (e.g. appointments).
- **Problem it solves:** Shows bookings and performance across branches in one view.
- **Key features:**
  - Bookings, branches and managers in one view
  - Lifetime and monthly statistics
  - Booking calendar per branch
- **Pitch line:** "One view of every branch's bookings and managers, with a calendar per location."
- **Demo or own tool?** Demo with sample data (prototype). **Confidence:** medium (card text only; "Prototype" tag).

### Desk (`desk/`) — Operations
- **What it does:** Turns Outlook emails into tasks. Users can attach booking links and confirmation PDFs and see what is done and what is left. Data is saved in the browser and the private cloud copy.
- **Who it's for:** Office or admin staff who handle requests and bookings by email.
- **Problem it solves:** Stops requests living only in the inbox.
- **Key features:**
  - Drag an email onto the page or paste its text to make a task
  - Attachments (booking links, PDFs)
  - Done/left overview and settings
- **Pitch line:** "Drag an Outlook email onto the page and it becomes a tracked task, with the confirmation attached."
- **Demo or own tool?** Own tool (real data). **Confidence:** high (headings verified).

### Pisarna DMS Demo (`pisarna-dms/`) — Operations
- **What it does:** A document-management demo with fictional data. Visitors sign in as a demo user with a shared demo password, and changes stay in the browser.
- **Who it's for:** Companies or public-sector offices that manage documents and records.
- **Problem it solves:** Lets prospects try a document system before buying.
- **Key features:**
  - Demo sign-in with fictional users
  - Document management views
  - Changes kept in the browser only
- **Pitch line:** "Try a document-management system with fake data, sign in and click around."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text and title only).

### Time & leave (`leave/`) — People & IT
- **What it does:** Handles leave requests and approvals, with a team calendar that includes Slovenian and Croatian public holidays. It shows everyone's remaining days, lets people clock in on the phone and produces a monthly working-time record.
- **Who it's for:** HR and managers at companies with staff in Slovenia and Croatia.
- **Problem it solves:** Replaces scattered leave emails and spreadsheets.
- **Key features:**
  - Leave requests and approvals
  - Team calendar with SI/HR holidays
  - Phone clock-in and monthly time record
- **Pitch line:** "Leave requests, approvals and clock-in in one app, with Slovenian and Croatian holidays built in."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only; marked "New").

### Team Tasks (`team-tasks/`) — People & IT
- **What it does:** A Linear-style issue tracker with lists and boards grouped by status, cycles, projects, an inbox, a ⌘K command menu and keyboard shortcuts.
- **Who it's for:** Software or product teams.
- **Problem it solves:** Tracks team work in a fast, keyboard-first tool.
- **Key features:**
  - Lists and boards by status, cycles and projects
  - Inbox and ⌘K command menu
  - Keyboard shortcuts
- **Pitch line:** "A fast, keyboard-driven task tracker for your team, with cycles and boards."
- **Demo or own tool?** Demo with fake data (saved in browser and cloud copy). **Confidence:** medium (card text only).

### Joiners & leavers (`onboarding/`) — People & IT
- **What it does:** Checklists for new hires, moves and leavers: accounts, licences, attendance cards, keys and equipment. It flags overdue tasks by team and makes sure nothing is missed on the last day.
- **Who it's for:** HR and IT admins.
- **Problem it solves:** Stops access and equipment being forgotten when people start or leave.
- **Key features:**
  - Checklists for joiners, movers and leavers
  - Overdue tasks by team
  - Last-day checks (accounts, keys, equipment)
- **Pitch line:** "No one leaves or joins with an account still open or a key not returned."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only).

### Portal usage & speed (`hub-usage/`) — People & IT
- **What it does:** Shows who uses which apps on an internal apps portal, how fast and reliable each one is, which apps could be retired, and what the cloud costs.
- **Who it's for:** IT managers running internal tools.
- **Problem it solves:** Shows which internal apps are used, slow or costly.
- **Key features:**
  - Usage by person and app
  - Speed and reliability per app
  - Retirement candidates and cloud cost
- **Pitch line:** "See which internal apps people really use, which are slow, and which you could retire."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only).

### n8n Runs (`n8n/`) — People & IT
- **What it does:** Shows every n8n automation workflow: health, scheduled runs per day, missed and failed runs, and when each was last deployed. The live version reads a run tracker.
- **Who it's for:** Ops or IT staff who run n8n automations.
- **Problem it solves:** Shows at a glance whether automations are running.
- **Key features:**
  - Health and scheduled runs per day
  - Missed and failed run alerts
  - Last-deployed date per workflow
- **Pitch line:** "See every automation's health and any missed run in one screen."
- **Demo or own tool?** Demo with fake data (a live version reads the run tracker). **Confidence:** medium (headings and card text).

### Analytics (`analytics/`) — Insights
- **What it does:** A dashboard for sales, stores, the e-commerce funnel, marketing return on ad spend, customer cohorts and products, with filters and comparisons.
- **Who it's for:** Management and analysts at retail or e-commerce companies.
- **Problem it solves:** Puts the main business numbers in one place with filters.
- **Key features:**
  - Sales, store and funnel dashboards
  - Marketing return and customer cohorts
  - Filters and period comparisons
- **Pitch line:** "One dashboard for sales, stores, the webshop funnel and marketing return, with filters you can change live."
- **Demo or own tool?** Demo with generated data. **Confidence:** medium (card text only).

### Data health check (`datacheck/`) — Insights
- **What it does:** You drop in a customer, supplier or product list and it finds what is broken: invalid VAT numbers and IBANs, duplicates and missing fields. It can fix them in one click and gives back a clean file and a report. Files never leave the browser.
- **Who it's for:** Anyone who maintains customer or supplier master data, such as finance, sales ops or data teams.
- **Problem it solves:** Cleans messy lists before they cause failed invoices or bank payments.
- **Key features:**
  - Checks VAT numbers (VIES) and IBANs, duplicates and missing fields
  - One-click fixes
  - Clean file and report download; files stay in the browser
- **Pitch line:** "Drop in your customer list and get back a clean file with bad VAT numbers and IBANs fixed."
- **Demo or own tool?** Own tool (user's own files, read locally). **Confidence:** high (card text and worker notes verified).

### Ads & Return (`ads/`) — Insights
- **What it does:** Compares Google Ads and Meta spend with GA4 revenue and store bookings. It shows return per market, every campaign, cost per booking, budget pacing and wasted spend.
- **Who it's for:** Marketing managers spending on paid ads across markets.
- **Problem it solves:** Shows which ad spend really brings revenue.
- **Key features:**
  - Spend vs revenue and bookings per market
  - Campaign-level cost per booking
  - Budget pacing and wasted-spend view
- **Pitch line:** "See which ad spend really brings bookings and which is wasted, market by market."
- **Demo or own tool?** Demo with fake data (live version reads the ad accounts). **Confidence:** medium (card text only).

### Margin leak & discount guard (`margin/`) — Insights
- **What it does:** Shows which discount codes, price lists, brands and shops lose margin, and lists yesterday's sales that were sold below cost.
- **Who it's for:** Retail or e-commerce finance and pricing managers.
- **Problem it solves:** Catches discounts and sales that lose money.
- **Key features:**
  - Margin by discount code, price list, brand and shop
  - Yesterday's negative-margin sales
- **Pitch line:** "Find the discount codes and sales that quietly lose you money, every day."
- **Demo or own tool?** Demo with fake data (live version reads sales and cost data). **Confidence:** medium (card text and title only).

### Webshop conversion health (`webshop/`) — Insights
- **What it does:** Shows where shoppers drop off across five webshops, by shop, device, category and landing page. It also flags tracking that looks broken.
- **Who it's for:** E-commerce managers and marketing analysts.
- **Problem it solves:** Shows where the shop loses buyers and whether the tracking can be trusted.
- **Key features:**
  - Drop-off by shop, device, category and landing page
  - Broken-tracking warnings
- **Pitch line:** "See exactly where shoppers drop off on each webshop, and whether your tracking is broken."
- **Demo or own tool?** Demo with fake data (live version reads GA4). **Confidence:** medium (card text only).

### Customer service quality (`cs-quality/`) — Insights
- **What it does:** Shows customer service measures: NPS, first-answer times, SLA compliance, call volumes and how much the AI chatbot handles, by market and queue.
- **Who it's for:** Customer service managers and directors.
- **Problem it solves:** Tracks service levels and the chatbot's impact in one view.
- **Key features:**
  - NPS and first-answer time
  - SLA and call volume by market and queue
  - Chatbot share of handled contacts
- **Pitch line:** "One view of your service levels, NPS and how much work the chatbot takes off your team."
- **Demo or own tool?** Demo with fake data. **Confidence:** medium (card text only).

### Showcase (`showcase/`) — Studio
- **What it does:** The company's own showcase site. It presents data warehousing, Power BI, analytics, predictions, automation and business apps, with live product mock-ups and links to the demos.
- **Who it's for:** Prospective clients (the sales page for the consultancy).
- **Problem it solves:** Shows what the firm offers and lets prospects click into demos.
- **Key features:**
  - Service sections (data, Power BI, automation, apps)
  - Live product mock-ups
  - Links to demos, FAQ
- **Pitch line:** "Here is what we build, and you can click into live examples right now."
- **Demo or own tool?** Demo/marketing site with illustrative data. **Confidence:** high (title and card verified).

### ERP & BI Client Atlas (`client-atlas/`) — Studio
- **What it does:** A sales-prospecting tool for finding paying clients for ERP, CRM, Power BI and data work, from Slovenia out to Europe. It has filters, a market map, leads, deadlines that create projects, outreach drafts and a search kit. Pipeline progress is saved in the private cloud copy.
- **Who it's for:** The consultancy's own business development (owner).
- **Problem it solves:** Organises where and how to find new consulting clients.
- **Key features:**
  - Market map and filtered leads
  - Project-triggering deadlines
  - Outreach drafts and search kit
- **Pitch line:** "Not a prospect-facing demo: this is our own tool for finding consulting clients."
- **Demo or own tool?** Own work tool (real data). **Confidence:** high (headings verified). Note: not a customer product.

Sources (local files, no web lookups):
- site/index.html
- HANDOFF.md
- CLAUDE.md
- Per-app `site/<folder>/index.html` (titles and h2 headings)

Not checked: main JS of each app (not read); design-compare excluded per brief. Medium-confidence entries rest on card text, which is what the home page promises, not on verified features. Names of the company and its people were left out, per the public-repo rule.