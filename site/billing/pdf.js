/* Invoice PDF (A4) from an issued document's frozen snapshot, or a draft preview.
 * pdfmake (Roboto: full č/š/ž support) and qrcode-generator load on first use. */
(function (root) {
  'use strict';
  const C = root.BillingCore;
  const LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  ];
  let loading = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(el);
    });
  }
  function ready() {
    if (!loading) loading = LIBS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
    return loading;
  }

  const L = {
    sl: {
      invoice: 'RAČUN', credit: 'DOBROPIS', draft: 'OSNUTEK – NI VELJAVEN RAČUN', number: 'Številka', issueDate: 'Datum izdaje',
      supply: 'Datum opravljene dobave', period: 'Obdobje opravljanja storitev', due: 'Rok plačila', reference: 'Sklic',
      billTo: 'Kupec', vatId: 'ID za DDV', taxNo: 'Davčna številka', regNo: 'Matična številka',
      desc: 'Opis', qty: 'Količina', unit: 'EM', price: 'Cena brez DDV', disc: 'Popust', rate: 'DDV', amount: 'Znesek brez DDV',
      base: 'Osnova', vat: 'DDV', net: 'Skupaj brez DDV', vatTotal: 'Skupaj DDV', total: 'Za plačilo', totalCredit: 'Skupaj dobropis',
      pay: 'Plačilo', payText: 'Prosimo, plačajte na transakcijski račun', bank: 'Banka', creditFor: 'Dobropis k računu',
      dated: 'z dne', court: 'Registrsko sodišče', capital: 'Osnovni kapital', scan: 'Skeniraj in plačaj', note: 'Opomba',
      draftNo: 'dodeljena ob izdaji',
    },
    en: {
      invoice: 'INVOICE', credit: 'CREDIT NOTE', draft: 'DRAFT – NOT A VALID INVOICE', number: 'Number', issueDate: 'Issue date',
      supply: 'Date of supply', period: 'Service period', due: 'Due date', reference: 'Payment reference',
      billTo: 'Bill to', vatId: 'VAT ID', taxNo: 'Tax number', regNo: 'Registration no.',
      desc: 'Description', qty: 'Qty', unit: 'Unit', price: 'Unit price excl. VAT', disc: 'Discount', rate: 'VAT', amount: 'Amount excl. VAT',
      base: 'Base', vat: 'VAT', net: 'Total excl. VAT', vatTotal: 'Total VAT', total: 'Amount due', totalCredit: 'Credit total',
      pay: 'Payment', payText: 'Please pay by bank transfer to', bank: 'Bank', creditFor: 'Credit note for invoice',
      dated: 'dated', court: 'Registry court', capital: 'Share capital', scan: 'Scan to pay', note: 'Note',
      draftNo: 'assigned when issued',
    },
  };
  const COUNTRY = { SI: 'Slovenija', HR: 'Hrvaška', AT: 'Avstrija', IT: 'Italija', DE: 'Nemčija', HU: 'Madžarska' };
  const num = (v, d = 2) => Number(v).toLocaleString('sl-SI', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 4), useGrouping: 'always' });
  const pct = (v) => `${String(v).replace('.', ',')} %`;
  const iban = (s) => String(s || '').replace(/(.{4})(?=.)/g, '$1 ');

  function qrSvg(snap, amountCents) {
    const kind = C.qrKind(snap);
    if (!kind || !(amountCents > 0)) return null;
    let data, qr;
    if (kind === 'upn') {
      data = String.fromCharCode(...C.toLatin2Bytes(C.upnQrText(snap, amountCents)));
      qr = root.qrcode(15, 'M');
    } else {
      data = String.fromCharCode(...new TextEncoder().encode(C.epcQrText(snap, amountCents)));
      qr = root.qrcode(0, 'M');
    }
    qr.addData(data, 'Byte'); // default stringToBytes keeps each char code's low byte
    qr.make();
    return { kind, svg: qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true }) };
  }

  function docDefinition(snap, { draft = false, amountDue } = {}) {
    const t = L[snap.lang] || L.sl;
    const credit = snap.kind === 'credit_note';
    const s = snap.issuer, c = snap.customer;
    const muted = '#6B6964';
    const small = { fontSize: 8, color: muted };
    const period = snap.supplyTo && snap.supplyTo !== snap.supplyFrom;
    const meta = [
      [t.number, snap.number || t.draftNo],
      [t.issueDate, C.dmy(snap.issueDate)],
      [period ? t.period : t.supply, period ? `${C.dmy(snap.supplyFrom)} – ${C.dmy(snap.supplyTo)}` : C.dmy(snap.supplyFrom)],
    ];
    if (snap.dueDate) meta.push([t.due, C.dmy(snap.dueDate)]);
    if (snap.reference) meta.push([t.reference, snap.reference]);

    const issuerLines = [s.address, s.postalCity,
      s.vatRegistered ? `${t.vatId}: ${s.vatId}` : `${t.taxNo}: ${s.taxNumber}`,
      s.registrationNumber ? `${t.regNo}: ${s.registrationNumber}` : null,
      [s.email, s.phone, s.web].filter(Boolean).join(' · ') || null].filter(Boolean);

    const customerLines = [c.address, c.postalCity, c.country && c.country !== 'SI' ? (COUNTRY[c.country] || c.country) : null,
      c.vatId ? `${t.vatId}: ${c.vatId}` : (c.taxNumber ? `${t.taxNo}: ${c.taxNumber}` : null)].filter(Boolean);

    const head = [t.desc, t.qty, t.unit, t.price, t.disc, t.rate, t.amount].map((h, i) => ({ text: h, style: 'th', alignment: i === 0 ? 'left' : 'right' }));
    const rows = snap.lines.map((l) => [
      { text: l.description },
      { text: num(l.qty, Number.isInteger(l.qty) ? 0 : 2), alignment: 'right' },
      { text: l.unit || '', alignment: 'right' },
      { text: num(l.unitPrice), alignment: 'right' },
      { text: l.discountPct ? pct(l.discountPct) : '', alignment: 'right' },
      { text: snap.issuer.vatRegistered && l.rate ? pct(l.rate) : '–', alignment: 'right' },
      { text: num(l.net / 100), alignment: 'right' },
    ]);

    const totalsBody = [];
    if (snap.issuer.vatRegistered) {
      for (const r of snap.totals.byRate) {
        totalsBody.push([{ text: `${t.base} ${r.rate ? pct(r.rate) : '0 %'}`, style: 'tl' }, { text: C.eur(r.base), alignment: 'right' }]);
        if (r.rate) totalsBody.push([{ text: `${t.vat} ${pct(r.rate)}`, style: 'tl' }, { text: C.eur(r.vat), alignment: 'right' }]);
      }
    }
    totalsBody.push([{ text: t.net, style: 'tl' }, { text: C.eur(snap.totals.net), alignment: 'right' }]);
    if (snap.issuer.vatRegistered) totalsBody.push([{ text: t.vatTotal, style: 'tl' }, { text: C.eur(snap.totals.vat), alignment: 'right' }]);
    totalsBody.push([{ text: credit ? t.totalCredit : t.total, bold: true, fontSize: 11 }, { text: C.eur(snap.totals.total), bold: true, fontSize: 11, alignment: 'right' }]);

    const content = [
      {
        columns: [
          [{ text: s.name, fontSize: 14, bold: true, margin: [0, 0, 0, 4] }, ...issuerLines.map((x) => ({ text: x, ...small }))],
          { width: 230, stack: [
            { text: credit ? t.credit : t.invoice, fontSize: 20, bold: true, alignment: 'right' },
            { text: snap.number || '', fontSize: 11, alignment: 'right', margin: [0, 2, 0, 10] },
            { table: { widths: ['*', 'auto'], body: meta.map(([k, v]) => [{ text: k, ...small }, { text: v, alignment: 'right', fontSize: 9 }]) }, layout: 'noBorders' },
          ] },
        ],
      },
      draft ? { text: t.draft, color: '#9A3412', bold: true, margin: [0, 14, 0, 0] } : null,
      { text: t.billTo.toUpperCase(), ...small, margin: [0, 22, 0, 2] },
      { text: c.name, bold: true },
      ...customerLines.map((x) => ({ text: x, fontSize: 9 })),
      snap.creditOf ? { text: `${t.creditFor} ${snap.creditOf.number} ${t.dated} ${C.dmy(snap.creditOf.issueDate)}`, bold: true, margin: [0, 14, 0, 0] } : null,
      {
        margin: [0, 18, 0, 0],
        table: { headerRows: 1, widths: ['*', 40, 30, 62, 38, 34, 70], body: [head, ...rows] },
        layout: { hLineWidth: (i, n) => (i === 0 || i === 1 || i === n.table.body.length ? 0.6 : 0.2), vLineWidth: () => 0, hLineColor: () => '#C9C5BC', paddingTop: () => 5, paddingBottom: () => 5 },
        fontSize: 9,
      },
      { columns: [{ text: '' }, { width: 240, margin: [0, 10, 0, 0], table: { widths: ['*', 'auto'], body: totalsBody }, layout: 'noBorders', fontSize: 9 }] },
      ...snap.clauses.map((x) => ({ text: x, bold: true, fontSize: 9, margin: [0, 10, 0, 0] })),
      snap.note ? { text: `${t.note}: ${snap.note}`, fontSize: 9, margin: [0, 10, 0, 0] } : null,
    ].filter(Boolean);

    const due = amountDue == null ? snap.totals.total : amountDue;
    if (!credit && s.iban && due > 0) {
      const qr = draft ? null : qrSvg(snap, due);
      content.push({
        margin: [0, 22, 0, 0],
        table: { widths: ['*', qr ? 110 : 0], body: [[
          { stack: [
            { text: t.pay.toUpperCase(), ...small, margin: [0, 0, 0, 4] },
            { text: `${t.payText}:`, fontSize: 9 },
            { text: `IBAN ${iban(s.iban)}${s.bic ? `   BIC ${s.bic}` : ''}`, bold: true, fontSize: 10, margin: [0, 2, 0, 2] },
            s.bank ? { text: `${t.bank}: ${s.bank}`, fontSize: 9 } : null,
            { text: `${t.reference}: ${snap.reference || t.draftNo}`, fontSize: 9 },
            { text: `${t.total}: ${C.eur(due)}${snap.dueDate ? ` · ${t.due}: ${C.dmy(snap.dueDate)}` : ''}`, fontSize: 9 },
          ].filter(Boolean) },
          qr ? { stack: [{ svg: qr.svg, width: 100, alignment: 'right' }, { text: qr.kind === 'upn' ? 'UPN QR' : 'SEPA QR', ...small, alignment: 'right' }] } : { text: '' },
        ]] },
        layout: { hLineWidth: () => 0.4, vLineWidth: () => 0.4, hLineColor: () => '#C9C5BC', vLineColor: () => '#C9C5BC', paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 10, paddingBottom: () => 10 },
      });
    }

    const legal = [s.name, `${s.address}, ${s.postalCity}`,
      s.vatRegistered ? `${t.vatId} ${s.vatId}` : `${t.taxNo} ${s.taxNumber}`,
      s.registrationNumber ? `${t.regNo} ${s.registrationNumber}` : null,
      s.court ? `${t.court}: ${s.court}` : null, s.shareCapital ? `${t.capital}: ${s.shareCapital}` : null].filter(Boolean).join(' · ');

    return {
      pageSize: 'A4', pageMargins: [48, 48, 48, 64],
      info: { title: `${credit ? t.credit : t.invoice} ${snap.number || ''}`.trim(), author: s.name },
      defaultStyle: { font: 'Roboto', fontSize: 10, color: '#0C0C0D' },
      styles: { th: { fontSize: 8, color: muted, bold: true }, tl: { color: '#55544F' } },
      watermark: draft ? { text: 'OSNUTEK', color: '#9A3412', opacity: 0.08, bold: true } : undefined,
      content,
      footer: (page, pages) => ({ margin: [48, 16, 48, 0], columns: [
        { text: [legal, snap.footer ? `\n${snap.footer}` : ''].join(''), fontSize: 7, color: muted },
        { text: `${page}/${pages}`, width: 30, alignment: 'right', fontSize: 7, color: muted },
      ] }),
    };
  }

  async function blob(snap, opts) {
    await ready();
    const def = docDefinition(snap, opts);
    return new Promise((resolve) => root.pdfMake.createPdf(def).getBlob(resolve));
  }

  root.BillingPdf = { ready, docDefinition, blob, qrSvg };
})(window);
