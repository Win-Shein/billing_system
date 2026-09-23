'use strict';

const express = require('express');
const db = require('../db/database');
const { round2, expenseVatAmount } = require('../lib/euerCategories');

const router = express.Router();

// List with optional category / date-range / search filters.
router.get('/', (req, res) => {
  const clauses = ['e.org_id = @org'];
  const params = { org: req.orgId };
  const category = (req.query.category || '').trim();
  const from = req.query.from;
  const to = req.query.to;
  const search = (req.query.search || '').trim();

  if (category) { clauses.push('e.category = @category'); params.category = category; }
  if (from) { clauses.push('e.expense_date >= @from'); params.from = from; }
  if (to) { clauses.push('e.expense_date <= @to'); params.to = to; }
  if (search) {
    clauses.push('(IFNULL(e.description,"") LIKE @s OR IFNULL(e.supplier,"") LIKE @s OR IFNULL(e.document_ref,"") LIKE @s)');
    params.s = `%${search}%`;
  }

  const rows = db
    .prepare(
      `SELECT e.* FROM expenses e
        WHERE ${clauses.join(' AND ')}
        ORDER BY e.expense_date DESC, e.id DESC`
    )
    .all(params);

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(amount_gross),0) AS gross, COALESCE(SUM(vat_amount),0) AS vat
         FROM expenses e
        WHERE ${clauses.join(' AND ')}`
    )
    .get(params);

  res.json({ rows, totals: { gross: round2(totals.gross), vat: round2(totals.vat) } });
});

// Category totals over an optional date range (for the EÜR summary).
router.get('/summary', (req, res) => {
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) AS n, COALESCE(SUM(amount_gross),0) AS gross, COALESCE(SUM(vat_amount),0) AS vat
         FROM expenses
        WHERE org_id = ? AND expense_date BETWEEN ? AND ?
        GROUP BY category ORDER BY gross DESC`
    )
    .all(req.orgId, from, to);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  res.json(expense);
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.expense_date) return res.status(400).json({ error: 'expense_date is required' });
  if (!b.category || !b.category.trim()) return res.status(400).json({ error: 'A category is required' });
  const amountGross = Number(b.amount_gross);
  if (!amountGross || amountGross <= 0) return res.status(400).json({ error: 'A positive amount is required' });

  const vatRate = Number(b.vat_rate) || 0;
  const vatAmount = expenseVatAmount(amountGross, vatRate);

  const info = db
    .prepare(
      `INSERT INTO expenses
         (org_id, expense_date, category, description, supplier, amount_gross, vat_rate, vat_amount, payment_method, document_ref, notes)
       VALUES (@org, @expense_date, @category, @description, @supplier, @amount_gross, @vat_rate, @vat_amount, @payment_method, @document_ref, @notes)`
    )
    .run({
      org: req.orgId,
      expense_date: b.expense_date,
      category: b.category.trim(),
      description: b.description || null,
      supplier: b.supplier || null,
      amount_gross: round2(amountGross),
      vat_rate: vatRate,
      vat_amount: vatAmount,
      payment_method: b.payment_method || null,
      document_ref: b.document_ref || null,
      notes: b.notes || null,
    });

  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });
  const b = req.body;
  if (b.category && !b.category.trim()) return res.status(400).json({ error: 'A category is required' });

  const amountGross = b.amount_gross != null ? Number(b.amount_gross) : existing.amount_gross;
  const vatRate = b.vat_rate != null ? Number(b.vat_rate) : existing.vat_rate;
  const vatAmount = expenseVatAmount(amountGross, vatRate);

  db.prepare(
    `UPDATE expenses
        SET expense_date=@expense_date, category=@category, description=@description, supplier=@supplier,
            amount_gross=@amount_gross, vat_rate=@vat_rate, vat_amount=@vat_amount,
            payment_method=@payment_method, document_ref=@document_ref, notes=@notes,
            updated_at=datetime('now')
      WHERE id=@id AND org_id=@org`
  ).run({
    id: req.params.id, org: req.orgId,
    expense_date: b.expense_date ?? existing.expense_date,
    category: b.category != null ? b.category.trim() : existing.category,
    description: b.description ?? existing.description,
    supplier: b.supplier ?? existing.supplier,
    amount_gross: round2(amountGross),
    vat_rate: vatRate,
    vat_amount: vatAmount,
    payment_method: b.payment_method ?? existing.payment_method,
    document_ref: b.document_ref ?? existing.document_ref,
    notes: b.notes ?? existing.notes,
  });

  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM expenses WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });
  db.prepare('DELETE FROM expenses WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  res.json({ ok: true });
});

module.exports = router;
