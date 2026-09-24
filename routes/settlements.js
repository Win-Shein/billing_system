'use strict';

/**
 * EUR settlement tracking (Zuflussprinzip) — records the actual bank-credited
 * amount for an issued invoice, independent of the `payments` table which
 * tracks the invoice balance in its billed currency. Used to generate the
 * German tax advisor export (see routes/reports.js -> /tax-export).
 */

const express = require('express');
const db = require('../db/database');
const { round2 } = require('../lib/euerCategories');
const { auditReq } = require('../lib/audit');

const router = express.Router();

function loadInvoice(id, orgId) {
  return db.prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?').get(id, orgId);
}

// List — optionally filtered to a single invoice.
router.get('/', (req, res) => {
  const { invoice_id } = req.query;
  const rows = invoice_id
    ? db
        .prepare('SELECT * FROM payment_settlements WHERE invoice_id = ? AND org_id = ? ORDER BY settlement_date DESC, id DESC')
        .all(invoice_id, req.orgId)
    : db
        .prepare(
          `SELECT s.*, i.invoice_no, c.name AS customer_name
             FROM payment_settlements s
             JOIN invoices i ON i.id = s.invoice_id
             JOIN customers c ON c.id = i.customer_id
            WHERE s.org_id = ?
            ORDER BY s.settlement_date DESC, s.id DESC
            LIMIT 500`
        )
        .all(req.orgId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.invoice_id) return res.status(400).json({ error: 'invoice_id is required' });
  const inv = loadInvoice(b.invoice_id, req.orgId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!inv.is_locked) return res.status(409).json({ error: 'Invoice must be issued before recording a settlement' });

  if (!b.settlement_date) return res.status(400).json({ error: 'settlement_date is required' });
  const billedAmount = Number(b.billed_amount);
  if (!billedAmount && billedAmount !== 0) return res.status(400).json({ error: 'billed_amount is required' });
  if (!b.billed_currency) return res.status(400).json({ error: 'billed_currency is required' });

  // settled_amount_eur can be given directly, or computed from the
  // exchange rate (1 billed currency unit = X EUR). The rate is always
  // stored for documentation (Finanzamt).
  const exchangeRate = b.exchange_rate != null && b.exchange_rate !== '' ? Number(b.exchange_rate) : null;
  let settledEur;
  if (b.settled_amount_eur != null && b.settled_amount_eur !== '') {
    settledEur = Number(b.settled_amount_eur);
  } else if (exchangeRate != null && exchangeRate > 0) {
    settledEur = round2(billedAmount * exchangeRate);
  } else {
    return res.status(400).json({ error: 'settled_amount_eur or a positive exchange_rate is required' });
  }
  if (Number.isNaN(settledEur)) return res.status(400).json({ error: 'settled_amount_eur is invalid' });

  const info = db
    .prepare(
      `INSERT INTO payment_settlements
         (org_id, invoice_id, settlement_date, billed_amount, billed_currency, settled_amount_eur, payment_method, gateway_fee_eur, exchange_rate, transaction_ref)
       VALUES (@org, @invoice_id, @settlement_date, @billed_amount, @billed_currency, @settled_amount_eur, @payment_method, @gateway_fee_eur, @exchange_rate, @transaction_ref)`
    )
    .run({
      org: req.orgId,
      invoice_id: b.invoice_id,
      settlement_date: b.settlement_date,
      billed_amount: billedAmount,
      billed_currency: String(b.billed_currency).toUpperCase(),
      settled_amount_eur: settledEur,
      payment_method: b.payment_method || null,
      gateway_fee_eur: Number(b.gateway_fee_eur) || 0,
      exchange_rate: exchangeRate,
      transaction_ref: b.transaction_ref || null,
    });

  auditReq(req, 'create', 'settlements', info.lastInsertRowid, { invoice_id: b.invoice_id, settled_amount_eur: settledEur });
  res.status(201).json(db.prepare('SELECT * FROM payment_settlements WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM payment_settlements WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!row) return res.status(404).json({ error: 'Settlement not found' });
  db.prepare('DELETE FROM payment_settlements WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  auditReq(req, 'delete', 'settlements', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
