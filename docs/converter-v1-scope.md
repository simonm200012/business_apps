# File converter for Business Apps: what's possible, and a v1 scope

Status: built (17 Oct 2026), not yet deployed: `site/convert/`, see HANDOFF.md, section "Convert". Not in v1 (as planned): OCR, faithful Word layout, e-invoice XML, password removal.

## The big finding: most of it already exists

My Apps already has **Convert** (`my-apps/public/convert/`, live at `/convert/`). It runs fully in the browser, uploads
nothing, uses no AI and no outside service, and has tests (`my-apps/tests/convert.test.mjs`). It already does:

| Tool | Libraries | Quality |
|---|---|---|
| Word → PDF | mammoth + pdfmake | good for normal documents; fonts, headers/footers, text boxes are not kept |
| Excel → PDF (.xlsx .xls .xlsm .ods) | SheetJS + pdfmake | every sheet as a clean table; no charts, colours, merged cells |
| CSV → PDF, Text/Markdown → PDF, Images → PDF | pdfmake, pdf-lib | good |
| PDF → Word | pdf.js + docx | text only, layout simplified, no OCR |
| PDF → text, PDF → images | pdf.js, JSZip | good |
| Merge PDF, Split PDF | pdf-lib | good |
| CSV ↔ Excel | SheetJS | good (numbers stay numbers, IBANs/postcodes stay text) |

The code is plain ES modules with 9.7 MB of vendored libraries (exact versions, licences included, all permissive:
MIT / Apache-2.0). It has no ties to the hub's server: only the header, the "My Apps" names in titles and PDF metadata,
and the hub's shared CSS (`/kit/…`). So it can be **copied into `business_apps/site/convert/`** and restyled to the Business
Apps look in about one builder session. No personal data in it.

## Each conversion asked for

| Conversion | Where it runs | Free? | How hard | Notes |
|---|---|---|---|---|
| Excel → PDF | browser | yes | done (reuse) | tables only; not a print-perfect copy of Excel's layout |
| Word → PDF | browser | yes | done (reuse), **faithful layout is hard** | real Word layout (fonts, columns, headers) needs LibreOffice or Word; no free in-browser way |
| Excel/CSV → XML | browser (SheetJS) | yes | easy | one `<row>` per line, tags from the header row; option: Excel's own "XML Spreadsheet 2003" format |
| XML → Excel/CSV | browser (built-in DOMParser + SheetJS) | yes | easy–medium | works for "flat" XML (repeated records); deeply nested XML is flattened with a warning |
| PDF → XML | browser (pdf.js) | yes | easy for text | pages → lines/paragraphs with page numbers; not the PDF's "meaning" (an invoice doesn't become e-invoice XML) |
| **PDF → Excel** | browser (pdf.js) | yes | **hard** | pdf.js gives words with x/y positions; rows and columns must be guessed. Works well on clean, computer-made tables (bank statements, price lists, reports); fails on scans (no text), merged cells, tables without clear columns |
| Excel ↔ JSON (bonus) | browser | yes | easy | useful for developers / imports |
| Scans → anything | needs OCR | — | hard | Tesseract.js could do it in the browser (free, ~10 MB+, slow on phones). Leave out of v1 |
| e-invoice XML (UBL / eSLOG) from PDF | — | — | hard / not reliable | needs reading the invoice's meaning; out of scope (Billing already makes proper invoices) |

**Cloudflare Worker:** not needed. Everything above runs in the browser, which is also the privacy win. A Worker on the
free plan has only ~10 ms CPU per request and could not run pdf.js or LibreOffice anyway.

## Privacy

- Files never leave the browser: no upload, no Worker, no third-party API, no AI. Libraries are served from our own
  site (vendored), not from a CDN, and pdfmake is told to refuse every URL.
- This is a selling point: "your contracts and statements never leave your computer", unlike iLovePDF/Smallpdf.
- The page shows a small "On this device" badge (as in the hub).

## Recommended v1

1. **Copy the hub's Convert** into Business Apps (`site/convert/`), in the Business Apps look, with its 12 tools and its
   tests (adapted to `tools/tests/`). Add it to the home page (Operations or a new "Tools" spot).
2. **Add four new tools:**
   - **PDF → Excel** (tables): pdf.js word positions → rows by y, columns by x gaps; one sheet per page or one sheet
     for all; a preview of the first rows before download, and a plain note that scans and complex tables won't work.
   - **Excel/CSV → XML** (simple rows, tag names from the header, safe XML names).
   - **XML → Excel** (repeated records become rows; nested values as `parent/child` columns).
   - **PDF → XML** (pages, paragraphs, lines; text only).
3. Tests for the new parts (table guessing on a few generated PDFs, XML both ways, tag-name cleaning).
4. Not in v1: OCR for scans, faithful Word layout, e-invoice XML, password removal.

Effort: one `builder` (Sonnet) session for the copy and restyle, one for the four new tools and tests; PDF → Excel is
the only part that may need a second pass. Fine to start after the usage reset (Tue 21 Oct).

## Look

The hub's Convert already has a look Simon picked (light grey page, white tool tiles, big red "Select files"). Proposal:
keep that layout and only switch colours and fonts to Business Apps, so no new mockup round is needed. If Simon wants
a different look, a builder makes 3 mockups first.
