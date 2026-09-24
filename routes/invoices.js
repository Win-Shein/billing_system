'use strict';

const express = require('express');
const db = require('../db/database');
const {
  recalcInvoice, replaceLineItems, draftInvoiceNo, issueInvoice, cancelInvoice,
} = require('../lib/invoiceService');
const { buildInvoicePdf } = require('../lib/pdf');
const { auditReq } = require('../lib/audit');

const router = express.Router();

function loadFull(id, orgId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(id, orgId);
  if (!inv) return null;
  inv.customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(inv.customer_id);
  inv.items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id')
    .all(id);
  inv.payments = db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC')
    .all(id);
  inv.settlements = db
    .prepare('SELECT * FROM payment_settlements WHERE invoice_id = ? ORDER BY settlement_date DESC, id DESC')
    .all(id);
  if (inv.original_invoice_id) {
    const orig = db.prepare('SELECT invoice_no FROM invoices WHERE id = ?').get(inv.original_invoice_id);
    inv.original_invoice_no = orig ? orig.invoice_no : null;
  }
  return inv;
}

// List with filters
router.get('/', (req, res) => {
  const { status, customer_id, search, from, to } = req.query;
  const clauses = ['i.org_id = @org'];
  const params = { org: req.orgId };
  if (status) { clauses.push('i.status = @status'); params.status = status; }
  if (customer_id) { clauses.push('i.customer_id = @customer_id'); params.customer_id = customer_id; }
  if (from) { clauses.push('i.issue_date >= @from'); params.from = from; }
  if (to) { clauses.push('i.issue_date <= @to'); params.to = to; }
  if (search) {
    clauses.push('(i.invoice_no LIKE @s OR c.name LIKE @s)');
    params.s = `%${search}%`;
  }
  const rows = db
    .prepare(
      `SELECT i.*, c.name AS customer_name, c.company AS customer_company
         FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.issue_date DESC, i.id DESC`
    )
    .all(params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const inv = loadFull(req.params.id, req.orgId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.json(inv);
});

// Create — always starts as an editable DRAFT. Drafts get a temporary
// placeholder invoice number; the real sequential number is only assigned
// when the invoice is issued (see POST /:id/issue), so deleting a draft
// never leaves a gap in the legal numbering sequence (GoBD).
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.customer_id) return res.status(400).json({ error: 'customer_id is required' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND org_id = ?').get(b.customer_id, req.orgId);
  if (!customer) return res.status(400).json({ error: 'Customer not found' });

  const settings = db.prepare('SELECT * FROM settings WHERE org_id = ?').get(req.orgId);

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO invoices
           (org_id, invoice_no, customer_id, issue_date, due_date, status, currency, discount, notes, terms,
            client_country, service_period_start, service_period_end)
         VALUES (@org, @invoice_no, @customer_id, @issue_date, @due_date, 'draft', @currency, @discount, @notes, @terms,
                 @client_country, @service_period_start, @service_period_end)`
      )
      .run({
        org: req.orgId,
        invoice_no: draftInvoiceNo(),
        customer_id: b.customer_id,
        issue_date: b.issue_date || new Date().toISOString().slice(0, 10),
        due_date: b.due_date || null,
        currency: b.currency || settings.currency,
        discount: Number(b.discount) || 0,
        notes: b.notes || null,
        terms: b.terms || null,
        client_country: b.client_country || customer.country || 'Myanmar',
        service_period_start: b.service_period_start || null,
        service_period_end: b.service_period_end || null,
      });
    const id = info.lastInsertRowid;
    replaceLineItems(id, b.items || []);
    recalcInvoice(id);
    return id;
  });

  const id = create();
  auditReq(req, 'create', 'invoices', id);
  res.status(201).json(loadFull(id, req.orgId));
});

// Update — only permitted while the invoice is still a DRAFT. Once issued,
// GoBD requires the document to be immutable; corrections must go through
// POST /:id/cancel (Stornorechnung) instead.
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.is_locked) {
    return res.status(409).json({ error: 'Invoice is issued and immutable. Use Cancel to create a correction (Stornorechnung).' });
  }
  const b = req.body;
  if (b.customer_id) {
    const c = db.prepare('SELECT id FROM customers WHERE id = ? AND org_id = ?').get(b.customer_id, req.orgId);
    if (!c) return res.status(400).json({ error: 'Customer not found' });
  }

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE invoices
         SET customer_id=@customer_id, issue_date=@issue_date, due_date=@due_date,
             status=@status, currency=@currency, discount=@discount, notes=@notes, terms=@terms,
             client_country=@client_country, service_period_start=@service_period_start,
             service_period_end=@service_period_end,
             updated_at=datetime('now')
       WHERE id=@id AND org_id=@org`
    ).run({
      id: req.params.id, org: req.orgId,
      customer_id: b.customer_id ?? existing.customer_id,
      issue_date: b.issue_date ?? existing.issue_date,
      due_date: b.due_date ?? existing.due_date,
      status: b.status ?? existing.status,
      currency: b.currency ?? existing.currency,
      discount: b.discount != null ? Number(b.discount) : existing.discount,
      notes: b.notes ?? existing.notes,
      terms: b.terms ?? existing.terms,
      client_country: b.client_country ?? existing.client_country,
      service_period_start: b.service_period_start ?? existing.service_period_start,
      service_period_end: b.service_period_end ?? existing.service_period_end,
    });
    if (Array.isArray(b.items)) replaceLineItems(req.params.id, b.items);
    recalcInvoice(req.params.id);
  });

  update();
  auditReq(req, 'update', 'invoices', req.params.id);
  res.json(loadFull(req.params.id, req.orgId));
});

// Change status only — also blocked once locked; automatic paid/partial/
// overdue transitions still happen via recalcInvoice (payments route).
router.patch('/:id/status', (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.is_locked) {
    return res.status(409).json({ error: 'Invoice is issued and immutable. Use Cancel to create a correction (Stornorechnung).' });
  }
  const allowed = ['draft', 'void'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare("UPDATE invoices SET status=?, updated_at=datetime('now') WHERE id=? AND org_id=?").run(
    req.body.status, req.params.id, req.orgId
  );
  recalcInvoice(req.params.id);
  auditReq(req, 'update', 'invoices', req.params.id, { status: req.body.status });
  res.json(loadFull(req.params.id, req.orgId));
});

// Issue — DRAFT → ISSUED. Assigns the real sequential invoice number,
// determines the VAT exemption clause, and locks the invoice.
router.post('/:id/issue', (req, res) => {
  const existing = db.prepare('SELECT id FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  try {
    issueInvoice(Number(req.params.id), req.orgId);
    auditReq(req, 'issue', 'invoices', req.params.id);
    res.json(loadFull(req.params.id, req.orgId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Cancel — creates a Stornorechnung (credit note) linked to this invoice
// and marks this one `cancelled`. Only possible for already-issued invoices.
router.post('/:id/cancel', (req, res) => {
  const existing = db.prepare('SELECT id FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  try {
    const result = cancelInvoice(Number(req.params.id), req.orgId);
    auditReq(req, 'cancel', 'invoices', req.params.id, { storno_id: result.storno.id, storno_no: result.storno.invoice_no });
    res.json({
      original: loadFull(req.params.id, req.orgId),
      storno: loadFull(result.storno.id, req.orgId),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Draft invoices only — issued invoices can never be deleted (GoBD), use
// Cancel instead to keep the sequential numbering intact.
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id, is_locked FROM invoices WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.is_locked) {
    return res.status(409).json({ error: 'Cannot delete an issued invoice. Use Cancel to create a Stornorechnung instead.' });
  }
  db.prepare('DELETE FROM invoices WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  auditReq(req, 'delete', 'invoices', req.params.id);
  res.json({ ok: true });
});

// PDF download
router.get('/:id/pdf', (req, res) => {
  const inv = loadFull(req.params.id, req.orgId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const settings = db.prepare('SELECT * FROM settings WHERE org_id = ?').get(req.orgId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_no}.pdf"`);
  buildInvoicePdf(inv, settings, res);
});

module.exports = router;
