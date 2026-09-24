'use strict';

const PDFDocument = require('pdfkit');

// German number formatting: dot thousands, comma decimal, currency after.
function money(n, symbol) {
  const v = (Number(n) || 0).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v} ${symbol}`;
}

const STATUS_DE = {
  draft: 'Entwurf',
  sent: 'Ausgestellt',
  paid: 'Bezahlt',
  partial: 'Teilweise bezahlt',
  overdue: 'Überfällig',
  void: 'Storniert',
  cancelled: 'Storniert',
};
function statusLabel(s) {
  return STATUS_DE[String(s).toLowerCase()] || String(s).toUpperCase();
}

/**
 * Stream a nicely formatted, German-language invoice PDF (Rechnung) to `out`
 * (an HTTP response or writable). All labels, the tax section and the
 * mandatory legal clauses are in German for Finanzamt / GoBD compliance.
 */
function buildInvoicePdf(inv, settings, out) {
  const sym = inv.currency === settings.currency ? settings.currency_symbol : inv.currency;
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(out);

  const left = 50;
  const right = 545;
  const dark = '#1f2937';
  const muted = '#6b7280';
  const accent = '#2563eb';
  const isStorno = !!inv.original_invoice_id;

  // ---- Header (optional logo on the left) ----
  let companyX = left;
  if (settings.logo_url && /^data:image\//.test(settings.logo_url)) {
    try {
      const b64 = settings.logo_url.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      const img = doc.openImage(buf);
      const scale = Math.min(110 / img.width, 55 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      doc.image(img, left, 45, { width: w, height: h });
      companyX = left + w + 12;   // place company name right next to the logo
    } catch (_) { /* ignore malformed logo */ }
  }
  doc.fillColor(dark).fontSize(20).font('Helvetica-Bold').text(settings.company_name, companyX, 50, { width: 210 });
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  const compLines = [settings.address, [settings.city, settings.country].filter(Boolean).join(', '),
    settings.phone, settings.email,
    inv.issuer_tax_number ? `Steuernummer: ${inv.issuer_tax_number}` : null,
    inv.issuer_ust_id ? `USt-IdNr: ${inv.issuer_ust_id}` : null]
    .filter(Boolean);
  doc.text(compLines.join('\n'), companyX, 75, { width: 210 });

  doc.fillColor(isStorno ? '#b91c1c' : accent).font('Helvetica-Bold').fontSize(isStorno ? 20 : 26)
    .text(isStorno ? 'STORNORECHNUNG' : 'RECHNUNG', 320, 50, { width: 225, align: 'right' });
  doc.fillColor(dark).font('Helvetica').fontSize(10)
    .text(`Rechnungsnummer: ${inv.invoice_no}`, 320, isStorno ? 76 : 82, { width: 225, align: 'right' });

  let metaY = isStorno ? 92 : 100;
  doc.fillColor(muted).fontSize(9);
  if (isStorno && inv.original_invoice_no) {
    doc.text(`Storniert: ${inv.original_invoice_no}`, 320, metaY, { width: 225, align: 'right' });
    metaY += 13;
  }
  doc.text(`Rechnungsdatum: ${inv.issue_date || '-'}`, 320, metaY, { width: 225, align: 'right' }); metaY += 13;
  doc.text(`Fälligkeitsdatum: ${inv.due_date || '-'}`, 320, metaY, { width: 225, align: 'right' }); metaY += 13;
  doc.text(`Status: ${statusLabel(inv.status)}`, 320, metaY, { width: 225, align: 'right' }); metaY += 13;
  if (inv.service_period_start || inv.service_period_end) {
    doc.text(
      `Leistungszeitraum: ${inv.service_period_start || '-'} – ${inv.service_period_end || '-'}`,
      320, metaY, { width: 225, align: 'right' }
    );
    metaY += 13;
  }

  // ---- Rechnungsempfänger (Bill To) ----
  const c = inv.customer || {};
  let y = 160;
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(9).text('RECHNUNGSEMPFÄNGER', left, y);
  y += 14;
  doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text(c.name || '-', left, y);
  y += 15;
  doc.font('Helvetica').fontSize(9).fillColor(muted);
  const custLines = [c.company, c.address, [c.city, inv.client_country || c.country].filter(Boolean).join(', '),
    c.phone, c.email].filter(Boolean);
  if (custLines.length) { doc.text(custLines.join('\n'), left, y); y += custLines.length * 12; }

  // ---- Table (columns sized to fit the currency) ----
  y = Math.max(y + 20, Math.max(250, metaY + 20));

  const amounts = (inv.items || []).flatMap((it) => [money(it.unit_price, sym), money(it.line_total, sym)]);
  const numW = Math.max(doc.widthOfString('Betrag'), doc.widthOfString('Preis'), ...amounts.map((s) => doc.widthOfString(s))) + 10;

  const totalW = numW;
  const taxW = 40;
  const qtyW = 30;
  const priceW = numW;
  const totalX = right - totalW;
  const taxX = totalX - taxW;
  const priceX = taxX - priceW;
  const qtyX = priceX - qtyW;
  const descX = left;
  const descW = qtyX - 6 - descX;

  doc.rect(left, y, right - left, 22).fill(accent);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('Beschreibung', descX + 6, y + 7, { width: descW });
  doc.text('Menge', qtyX, y + 7, { width: qtyW, align: 'right' });
  doc.text('Preis', priceX, y + 7, { width: priceW, align: 'right' });
  doc.text('USt. %', taxX, y + 7, { width: taxW, align: 'right' });
  doc.text('Betrag', totalX, y + 7, { width: totalW, align: 'right' });
  y += 22;

  // ---- Rows ----
  doc.font('Helvetica').fontSize(9);
  (inv.items || []).forEach((it, idx) => {
    const lines = Math.max(1, Math.ceil(doc.widthOfString(it.description) / (descW - 2)));
    const rowH = Math.max(20, lines * 11 + 8);
    if (y + rowH > 720) { doc.addPage(); y = 50; }
    if (idx % 2 === 1) doc.rect(left, y, right - left, rowH).fill('#f3f4f6');
    doc.fillColor(dark);
    doc.text(it.description, descX + 6, y + 6, { width: descW - 2 });
    doc.text(String(it.quantity), qtyX, y + 6, { width: qtyW, align: 'right' });
    doc.text(money(it.unit_price, sym), priceX, y + 6, { width: priceW, align: 'right' });
    doc.text(`${it.tax_rate}%`, taxX, y + 6, { width: taxW, align: 'right' });
    doc.text(money(it.line_total, sym), totalX, y + 6, { width: totalW, align: 'right' });
    y += rowH;
  });

  doc.moveTo(left, y).lineTo(right, y).strokeColor('#e5e7eb').stroke();

  // ---- Summen ----
  y += 12;
  const labelX = 330, labelW = 100, valX = 435, valW = right - valX;
  const totalRow = (label, value, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9)
      .fillColor(bold ? dark : muted);
    doc.text(label, labelX, y, { width: labelW, align: 'right' });
    doc.fillColor(dark).text(value, valX, y, { width: valW, align: 'right' });
    y += bold ? 18 : 15;
  };
  totalRow('Zwischensumme', money(inv.subtotal, sym));
  if (inv.discount) totalRow('Rabatt', `- ${money(inv.discount, sym)}`);
  totalRow(`Umsatzsteuer (${inv.vat_rate ?? 0}%)`, money(inv.tax_total, sym));
  doc.moveTo(labelX, y).lineTo(right, y).strokeColor('#e5e7eb').stroke();
  y += 6;
  totalRow('Gesamtbetrag', money(inv.total, sym), true);
  if (inv.amount_paid) {
    totalRow('Bezahlt', `- ${money(inv.amount_paid, sym)}`);
    totalRow('Restbetrag', money(inv.total - inv.amount_paid, sym), true);
  }

  // ---- VAT exemption clause (Drittland / Kleinunternehmer) ----
  if (inv.vat_exemption_reason) {
    y += 10;
    if (y > 700) { doc.addPage(); y = 50; }
    const boxH = 30;
    doc.rect(left, y, right - left, boxH).fill('#fef9c3');
    doc.fillColor('#78350f').font('Helvetica').fontSize(8)
      .text(inv.vat_exemption_reason, left + 8, y + 9, { width: right - left - 16 });
    y += boxH + 10;
  }

  // ---- Anmerkungen / Zahlungsbedingungen ----
  y += 10;
  if (inv.notes) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('Anmerkungen', left, y);
    doc.font('Helvetica').fillColor(dark).text(inv.notes, left, y + 12, { width: 300 });
    y += 40;
  }
  if (inv.terms) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('Zahlungsbedingungen', left, y);
    doc.font('Helvetica').fillColor(dark).text(inv.terms, left, y + 12, { width: 300 });
    y += 40;
  }

  // ---- Bankverbindung ----
  if (settings.bank_iban || settings.bank_name) {
    if (y > 700) { doc.addPage(); y = 50; }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('Bankverbindung', left, y);
    y += 12;
    const bankLines = [
      settings.bank_account_holder ? `Kontoinhaber: ${settings.bank_account_holder}` : null,
      settings.bank_name ? `Bank: ${settings.bank_name}` : null,
      settings.bank_iban ? `IBAN: ${settings.bank_iban}` : null,
      settings.bank_bic ? `BIC/SWIFT: ${settings.bank_bic}` : null,
      `Verwendungszweck: ${inv.invoice_no}`,
    ].filter(Boolean);
    doc.font('Helvetica').fontSize(9).fillColor(dark).text(bankLines.join('\n'), left, y, { width: 300 });
  }

  doc.fontSize(8).fillColor(muted)
    .text('Vielen Dank für Ihren Auftrag.', left, 780, { align: 'center', width: right - left });

  doc.end();
}

module.exports = { buildInvoicePdf };
