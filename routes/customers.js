'use strict';

const express = require('express');
const db = require('../db/database');
const { auditReq } = require('../lib/audit');

const router = express.Router();

// List (with optional search + invoice stats), scoped to the caller's org
router.get('/', (req, res) => {
  const q = `%${(req.query.search || '').trim()}%`;
  const rows = db
    .prepare(
      `SELECT c.*,
              COUNT(i.id)                       AS invoice_count,
              COALESCE(SUM(i.total),0)          AS total_billed,
              COALESCE(SUM(i.total - i.amount_paid),0) AS outstanding
         FROM customers c
         LEFT JOIN invoices i ON i.customer_id = c.id AND i.status != 'void'
        WHERE c.org_id = @org
          AND (c.name LIKE @q OR IFNULL(c.company,'') LIKE @q
               OR IFNULL(c.email,'') LIKE @q OR IFNULL(c.phone,'') LIKE @q)
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE`
    )
    .all({ q, org: req.orgId });
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const invoices = db
    .prepare('SELECT * FROM invoices WHERE customer_id = ? AND org_id = ? ORDER BY issue_date DESC, id DESC')
    .all(req.params.id, req.orgId);
  res.json({ ...customer, invoices });
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Name is required' });
  const info = db
    .prepare(
      `INSERT INTO customers (org_id, name, company, email, phone, address, city, country, tax_number, notes)
       VALUES (@org, @name, @company, @email, @phone, @address, @city, @country, @tax_number, @notes)`
    )
    .run({
      org: req.orgId,
      name: b.name.trim(),
      company: b.company || null,
      email: b.email || null,
      phone: b.phone || null,
      address: b.address || null,
      city: b.city || null,
      country: b.country || null,
      tax_number: b.tax_number || null,
      notes: b.notes || null,
    });
  auditReq(req, 'create', 'customers', info.lastInsertRowid, { name: b.name.trim() });
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM customers WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  const b = req.body;
  db.prepare(
    `UPDATE customers
       SET name=@name, company=@company, email=@email, phone=@phone, address=@address,
           city=@city, country=@country, tax_number=@tax_number, notes=@notes,
           is_active=@is_active, updated_at=datetime('now')
     WHERE id=@id AND org_id=@org`
  ).run({
    id: req.params.id, org: req.orgId,
    name: (b.name || existing.name).trim(),
    company: b.company ?? existing.company,
    email: b.email ?? existing.email,
    phone: b.phone ?? existing.phone,
    address: b.address ?? existing.address,
    city: b.city ?? existing.city,
    country: b.country ?? existing.country,
    tax_number: b.tax_number ?? existing.tax_number,
    notes: b.notes ?? existing.notes,
    is_active: b.is_active ?? existing.is_active,
  });
  auditReq(req, 'update', 'customers', req.params.id);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM customers WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  const used = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?').get(req.params.id);
  if (used.n > 0) {
    return res.status(409).json({ error: 'Cannot delete: customer has invoices. Deactivate instead.' });
  }
  db.prepare('DELETE FROM customers WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  auditReq(req, 'delete', 'customers', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
