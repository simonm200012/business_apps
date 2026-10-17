// Fictional sample invoices for the eSLOG tests and screenshots (Zelenik d.o.o. sells to Kamnik Logistika d.o.o.; the VAT
// ID and the IBAN are made-up values with correct check digits). Builds .xlsx files with the vendored SheetJS, so no binary
// fixtures are stored. Used by eslog-*.test.js.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const vendor = path.join(__dirname, '../../site/convert/vendor');
function loadXLSX() {
  if (!globalThis.XLSX) {
    // run it as a classic <script> would: in the global scope, with no module or exports (node -e defines them as globals)
    const saved = { module: globalThis.module, exports: globalThis.exports };
    delete globalThis.module; delete globalThis.exports;
    try { vm.runInThisContext(fs.readFileSync(path.join(vendor, 'xlsx-0.20.3/xlsx.full.min.js'), 'utf8'), { filename: 'xlsx.full.min.js' }); } finally { Object.assign(globalThis, saved); }
  }
  return globalThis.XLSX;
}

const SELLER = { name: 'Zelenik d.o.o.', vat: 'SI12345679', iban: 'SI50 1234 5678 9012 345', street: 'Cesta v Mestni log 1', zip: '1000', city: 'Ljubljana' };
const BUYER = { name: 'Kamnik Logistika d.o.o.', vat: 'SI10000003', street: 'Tunjiška cesta 2', zip: '1241', city: 'Kamnik' };

/** The Slovenian invoice of the mockup: labels in A, values in B, a table below, totals under it. `buyerVat: false` leaves the
 * buyer's VAT ID out. Numbers are real numbers; dates are text like 02.10.2026 unless `dates` is 'cells'. */
function slovenianRows({ buyerVat = true, iban = SELLER.iban } = {}) {
  return [
    ['RAČUN', ''],
    ['Številka računa', '2026-0142'],
    ['Datum izdaje', '02.10.2026'],
    ['Rok plačila', '01.11.2026'],
    ['Valuta', 'EUR'],
    [],
    ['Dobavitelj', SELLER.name],
    ['', `${SELLER.street}, ${SELLER.zip} ${SELLER.city}`],
    ['ID za DDV', SELLER.vat],
    ['IBAN', iban],
    [],
    ['Kupec', BUYER.name],
    ['', `${BUYER.street}, ${BUYER.zip} ${BUYER.city}`],
    ...(buyerVat ? [['ID za DDV', BUYER.vat]] : []),
    [],
    ['Št.', 'Opis', 'Količina', 'EM', 'Cena', 'DDV', 'Znesek'],
    [1, 'Prevoz paletnega blaga Ljubljana–Maribor', 12, 'kos', 85, '22 %', 1020],
    [2, 'Skladiščenje, oktober', 1, 'kos', 240, '22 %', 240],
    [3, 'Embalažni material', 40, 'kos', 3.5, '9,5 %', 140],
    [],
    ['', '', '', '', 'Skupaj brez DDV', '', 1400],
    ['', '', '', '', 'Za plačilo', '', 1690.5],
  ];
}
/** The same invoice in English, labels and values side by side, 1,234.56 numbers as text, ISO dates, VAT as a number. */
function englishRows() {
  return [
    ['Invoice', 'INV-2026-77'],
    ['Invoice date', '2026-10-02'],
    ['Due date', '2026-11-01'],
    ['Currency', 'EUR'],
    [],
    ['Supplier', SELLER.name],
    ['Address', `${SELLER.street}, ${SELLER.zip} ${SELLER.city}`],
    ['VAT ID', SELLER.vat],
    ['IBAN', SELLER.iban],
    ['Customer', BUYER.name],
    ['Address', `${BUYER.street}, ${BUYER.zip} ${BUYER.city}`],
    ['VAT ID', BUYER.vat],
    [],
    ['Description', 'Qty', 'Unit', 'Unit price', 'VAT %', 'Net amount'],
    ['Pallet transport Ljubljana-Maribor', '12', 'pcs', '85.00', 22, '1,020.00'],
    ['Storage, October', '1', 'pcs', '240.00', 22, '240.00'],
    [],
    ['Net total', '', '', '', '', '1,260.00'],
    ['VAT 22 %', '', '', '', '', '277.20'],
    ['Total due', '', '', '', '', '1,537.20'],
  ];
}

/** An .xlsx file (Uint8Array) from rows. With `cells`, date-looking texts become real date cells (format dd.mm.yyyy) and the
 * "22 %" texts become percentage cells, as Excel files from accounting programs have them. */
function makeXlsx(rows, { sheet = 'Racun', cells = false, extraSheet = false } = {}) {
  const XLSX = loadXLSX(), ws = XLSX.utils.aoa_to_sheet(rows), wb = XLSX.utils.book_new();
  if (cells) {
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const c = ws[addr];
      let m;
      if (c.t === 's' && (m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(c.v))) { c.t = 'n'; c.v = (Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86400000; c.z = 'dd\\.mm\\.yyyy'; delete c.w; }
      else if (c.t === 's' && (m = /^(\d+(?:,\d)?) ?%$/.exec(c.v))) { c.t = 'n'; c.v = Number(m[1].replace(',', '.')) / 100; c.z = '0.0%'; delete c.w; }
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  if (extraSheet) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notes'], ['nothing here']]), 'Notes');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }));
}

module.exports = { loadXLSX, slovenianRows, englishRows, makeXlsx, SELLER, BUYER };
