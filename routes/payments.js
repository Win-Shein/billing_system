'use strict';

const express = require('express');
const db = require('../db/database');
const { recalcInvoice } = require('../lib/invoiceService');
const { auditReq } = require('../lib/audit');

const router = express.Router();

// List recent payments (optionally by invoice), scoped to org
router.get('/', (req, res) => {
  const { invoice_id } = req.query;
  const rows = invoice_id
    ? db.prepare('SELECT * FROM payments WHERE invoice_id = ? AND org_id = ? ORDER BY paid_at DESC, id DESC').all(invoice_id, req.orgId)
    : db
        .prepare(
          `SELECT p.*, i.invoice_no, c.name AS customer_name
             FROM payments p
             JOIN invoices i ON i.id = p.invoice_id
             JOIN customers c ON c.id = i.customer_id
            WHERE p.org_id = ?
            ORDER BY p.paid_at DESC, p.id DESC
            LIMIT 200`
        )
        .all(req.orgId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.invoice_id) return res.status(400).json({ error: 'invoice_id is required' });
  const amount = Number(b.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'A positive amount is required' });

  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(b.invoice_id, req.orgId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const info = db
    .prepare(
      `INSERT INTO payments (org_id, invoice_id, amount, method, reference, paid_at, notes)
       VALUES (@org, @invoice_id, @amount, @method, @reference, @paid_at, @notes)`
    )
    .run({
      org: req.orgId,
      invoice_id: b.invoice_id,
      amount,
      method: b.method || 'bank',
      reference: b.reference || null,
      paid_at: b.paid_at || new Date().toISOString().slice(0, 10),
      notes: b.notes || null,
    });

  recalcInvoice(b.invoice_id);
  auditReq(req, 'create', 'payments', info.lastInsertRowid, { invoice_id: b.invoice_id, amount });
  res.status(201).json({
    payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid),
    invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(b.invoice_id),
  });
});

router.delete('/:id', (req, res) => {
  const pay = db.prepare('SELECT * FROM payments WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!pay) return res.status(404).json({ error: 'Payment not found' });
  db.prepare('DELETE FROM payments WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  recalcInvoice(pay.invoice_id);
  auditReq(req, 'delete', 'payments', req.params.id, { invoice_id: pay.invoice_id });
  res.json({ ok: true });
});

module.exports = router;
