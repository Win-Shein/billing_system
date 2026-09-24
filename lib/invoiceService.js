'use strict';

const crypto = require('crypto');
const db = require('../db/database');
const { computeVatExemption } = require('./taxRules');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Recompute an invoice's subtotal / tax / total from its line items and
 * recorded payments, then persist and return the fresh row.
 */
function recalcInvoice(invoiceId) {
  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ?')
    .all(invoiceId);

  let subtotal = 0;
  let taxTotal = 0;
  for (const it of items) {
    const line = round2(it.quantity * it.unit_price);
    subtotal += line;
    taxTotal += round2(line * (it.tax_rate / 100));
  }

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) return null;

  const discount = inv.discount || 0;
  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);
  // Normal invoices never go below zero. A Stornorechnung (cancellation
  // invoice) intentionally carries negative quantities/subtotal to
  // represent a credit note, so its total must stay negative too.
  const rawTotal = subtotal - discount + taxTotal;
  const total = round2(subtotal >= 0 ? Math.max(0, rawTotal) : rawTotal);

  const paidRow = db
    .prepare('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id = ?')
    .get(invoiceId);
  const amountPaid = round2(paidRow.paid);

  const status = deriveStatus(inv.status, total, amountPaid, inv.due_date);

  db.prepare(
    `UPDATE invoices
       SET subtotal = ?, tax_total = ?, total = ?, amount_paid = ?, status = ?,
           updated_at = datetime('now')
     WHERE id = ?`
  ).run(subtotal, taxTotal, total, amountPaid, status, invoiceId);

  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
}

/**
 * Work out the status of an invoice.
 * Manual states (draft, void) are preserved unless payments push it to paid/partial.
 */
function deriveStatus(current, total, amountPaid, dueDate) {
  if (current === 'void' || current === 'cancelled') return current;

  if (amountPaid >= total && total > 0) return 'paid';
  if (amountPaid > 0 && amountPaid < total) return 'partial';

  // No payments yet.
  if (current === 'draft') return 'draft';

  if (dueDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (dueDate < today) return 'overdue';
  }
  return current === 'paid' ? 'sent' : current || 'sent';
}

/** Replace all line items for an invoice inside a transaction, then recalc. */
const replaceLineItems = db.transaction((invoiceId, lines) => {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const insert = db.prepare(
    `INSERT INTO invoice_items
       (invoice_id, item_id, description, quantity, unit_price, tax_rate, line_total, sort_order)
     VALUES (@invoice_id, @item_id, @description, @quantity, @unit_price, @tax_rate, @line_total, @sort_order)`
  );
  lines.forEach((l, idx) => {
    const quantity = Number(l.quantity) || 0;
    const unitPrice = Number(l.unit_price) || 0;
    insert.run({
      invoice_id: invoiceId,
      item_id: l.item_id || null,
      description: l.description || '',
      quantity,
      unit_price: unitPrice,
      tax_rate: Number(l.tax_rate) || 0,
      line_total: round2(quantity * unitPrice),
      sort_order: idx,
    });
  });
});

/**
 * Reserve and return the next invoice number for an org and calendar year,
 * formatted as `<prefix>YYYY-XXXX` (e.g. `INV-2026-0001`). The sequence is
 * tracked per year so each fiscal year restarts at 0001, and numbers are
 * strictly sequential with no gaps for a given year (GoBD).
 */
const nextInvoiceNo = db.transaction((orgId, year) => {
  const s = db.prepare('SELECT invoice_prefix FROM settings WHERE org_id = ?').get(orgId);
  const row = db.prepare('SELECT next FROM invoice_sequences WHERE org_id = ? AND year = ?').get(orgId, year);
  const nextVal = row ? row.next : 1;
  if (row) {
    db.prepare('UPDATE invoice_sequences SET next = next + 1 WHERE org_id = ? AND year = ?').run(orgId, year);
  } else {
    db.prepare('INSERT INTO invoice_sequences (org_id, year, next) VALUES (?, ?, 2)').run(orgId, year);
  }
  return `${s.invoice_prefix}${year}-${String(nextVal).padStart(4, '0')}`;
});

/**
 * Drafts don't consume a real sequential invoice number — only invoices that
 * are actually issued do (GoBD: no gaps in the legal sequence). Give every
 * draft a unique, obviously-temporary placeholder instead.
 */
function draftInvoiceNo() {
  return `DRAFT-${crypto.randomUUID()}`;
}

/**
 * Transition a DRAFT invoice to ISSUED:
 *  - assigns the real sequential invoice number
 *  - snapshots the issuer's tax number
 *  - determines VAT exemption (Drittland / Kleinunternehmer) and, when
 *    exempt, zeroes out every line item's tax rate
 *  - marks the invoice immutable (is_locked = 1)
 *
 * Requires the invoice to already have a customer, at least one line item,
 * and a service period (Leistungszeitraum), as German law mandates these be
 * present on the final document.
 */
const issueInvoice = db.transaction((id, orgId) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(id, orgId);
  if (!inv) throw httpError('Invoice not found', 404);
  if (inv.is_locked) throw httpError('Invoice is already issued', 409);
  if (inv.original_invoice_id) throw httpError('A cancellation invoice cannot be issued again', 409);

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id);
  if (!items.length) throw httpError('Cannot issue an invoice with no line items', 400);
  if (!inv.service_period_start || !inv.service_period_end) {
    throw httpError('Service period (start & end date) is required before issuing (Leistungszeitraum)', 400);
  }

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(inv.customer_id);
  const settings = db.prepare('SELECT * FROM settings WHERE org_id = ?').get(orgId);
  const clientCountry = inv.client_country || (customer && customer.country) || 'Myanmar';
  const { vat_rate, vat_exemption_reason } = computeVatExemption({
    clientCountry,
    isKleinunternehmer: !!settings.is_kleinunternehmer,
  });

  if (vat_rate === 0) {
    db.prepare('UPDATE invoice_items SET tax_rate = 0 WHERE invoice_id = ?').run(id);
  }

  const year = (inv.issue_date || new Date().toISOString().slice(0, 10)).slice(0, 4);
  const invoiceNo = nextInvoiceNo(orgId, year);
  db.prepare(
    `UPDATE invoices
        SET invoice_no = @invoice_no, client_country = @client_country,
            issuer_tax_number = @issuer_tax_number, issuer_ust_id = @issuer_ust_id,
            vat_rate = @vat_rate,
            vat_exemption_reason = @vat_exemption_reason, is_locked = 1,
            status = 'sent', updated_at = datetime('now')
      WHERE id = @id`
  ).run({
    id,
    invoice_no: invoiceNo,
    client_country: clientCountry,
    issuer_tax_number: settings.steuernummer || settings.tax_number || null,
    issuer_ust_id: settings.ust_id || null,
    vat_rate: vat_rate === null ? inv.vat_rate : vat_rate,
    vat_exemption_reason,
  });

  return recalcInvoice(id);
});

/**
 * Create a Stornorechnung (cancellation / credit-note invoice) that mirrors
 * the target invoice's lines with negated quantities, gets its own
 * sequential invoice number, and links back via `original_invoice_id`. The
 * original is marked `cancelled` but its historical figures are left
 * untouched (GoBD immutability — corrections happen via a new document,
 * never by editing the original).
 */
const cancelInvoice = db.transaction((id, orgId) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(id, orgId);
  if (!inv) throw httpError('Invoice not found', 404);
  if (!inv.is_locked) throw httpError('Only an issued invoice can be cancelled (create a Stornorechnung)', 409);
  if (inv.status === 'cancelled') throw httpError('Invoice is already cancelled', 409);
  if (inv.original_invoice_id) throw httpError('A cancellation invoice cannot itself be cancelled', 409);

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id').all(id);
  const today = new Date().toISOString().slice(0, 10);
  const invoiceNo = nextInvoiceNo(orgId, today.slice(0, 4));

  const info = db.prepare(
    `INSERT INTO invoices
       (org_id, invoice_no, customer_id, issue_date, due_date, status, currency, discount,
        notes, terms, issuer_tax_number, issuer_ust_id, client_country, service_period_start,
        service_period_end, vat_rate, vat_exemption_reason, is_locked, original_invoice_id)
     VALUES (@org, @invoice_no, @customer_id, @issue_date, NULL, 'cancelled', @currency, 0,
             @notes, @terms, @issuer_tax_number, @issuer_ust_id, @client_country, @service_period_start,
             @service_period_end, @vat_rate, @vat_exemption_reason, 1, @original_invoice_id)`
  ).run({
    org: orgId,
    invoice_no: invoiceNo,
    customer_id: inv.customer_id,
    issue_date: today,
    currency: inv.currency,
    notes: `Stornorechnung for ${inv.invoice_no}`,
    terms: inv.terms,
    issuer_tax_number: inv.issuer_tax_number,
    issuer_ust_id: inv.issuer_ust_id,
    client_country: inv.client_country,
    service_period_start: inv.service_period_start,
    service_period_end: inv.service_period_end,
    vat_rate: inv.vat_rate,
    vat_exemption_reason: inv.vat_exemption_reason,
    original_invoice_id: inv.id,
  });
  const newId = info.lastInsertRowid;

  const insertLine = db.prepare(
    `INSERT INTO invoice_items
       (invoice_id, item_id, description, quantity, unit_price, tax_rate, line_total, sort_order)
     VALUES (@invoice_id, @item_id, @description, @quantity, @unit_price, @tax_rate, @line_total, @sort_order)`
  );
  items.forEach((it, idx) => {
    const qty = -Math.abs(it.quantity);
    insertLine.run({
      invoice_id: newId,
      item_id: it.item_id,
      description: it.description,
      quantity: qty,
      unit_price: it.unit_price,
      tax_rate: it.tax_rate,
      line_total: round2(qty * it.unit_price),
      sort_order: idx,
    });
  });

  recalcInvoice(newId);
  db.prepare("UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(id);

  return {
    original: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id),
    storno: db.prepare('SELECT * FROM invoices WHERE id = ?').get(newId),
  };
});

module.exports = {
  round2, recalcInvoice, replaceLineItems, nextInvoiceNo, deriveStatus,
  draftInvoiceNo, issueInvoice, cancelInvoice,
};
