'use strict';

const express = require('express');
const db = require('../db/database');
const { auditReq } = require('../lib/audit');

const router = express.Router();

router.get('/', (req, res) => {
  const q = `%${(req.query.search || '').trim()}%`;
  const category = (req.query.category || '').trim();
  const rows = db
    .prepare(
      `SELECT * FROM items
        WHERE org_id = @org
          AND (name LIKE @q OR IFNULL(sku,'') LIKE @q OR IFNULL(description,'') LIKE @q)
          AND (@category = '' OR category = @category)
        ORDER BY category, name COLLATE NOCASE`
    )
    .all({ q, category, org: req.orgId });
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Name is required' });
  const info = db
    .prepare(
      `INSERT INTO items (org_id, name, sku, description, category, billing_cycle, unit, price, tax_rate, stock)
       VALUES (@org, @name, @sku, @description, @category, @billing_cycle, @unit, @price, @tax_rate, @stock)`
    )
    .run({
      org: req.orgId,
      name: b.name.trim(),
      sku: b.sku || null,
      description: b.description || null,
      category: b.category || 'Other',
      billing_cycle: b.billing_cycle || 'one-time',
      unit: b.unit || 'pcs',
      price: Number(b.price) || 0,
      tax_rate: Number(b.tax_rate) || 0,
      stock: b.stock === '' || b.stock == null ? null : Number(b.stock),
    });
  auditReq(req, 'create', 'items', info.lastInsertRowid, { name: b.name.trim() });
  res.status(201).json(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const b = req.body;
  db.prepare(
    `UPDATE items
       SET name=@name, sku=@sku, description=@description, category=@category,
           billing_cycle=@billing_cycle, unit=@unit, price=@price,
           tax_rate=@tax_rate, stock=@stock, is_active=@is_active, updated_at=datetime('now')
     WHERE id=@id AND org_id=@org`
  ).run({
    id: req.params.id, org: req.orgId,
    name: (b.name || existing.name).trim(),
    sku: b.sku ?? existing.sku,
    description: b.description ?? existing.description,
    category: b.category ?? existing.category,
    billing_cycle: b.billing_cycle ?? existing.billing_cycle,
    unit: b.unit ?? existing.unit,
    price: b.price != null ? Number(b.price) : existing.price,
    tax_rate: b.tax_rate != null ? Number(b.tax_rate) : existing.tax_rate,
    stock: b.stock === '' ? null : b.stock != null ? Number(b.stock) : existing.stock,
    is_active: b.is_active ?? existing.is_active,
  });
  auditReq(req, 'update', 'items', req.params.id);
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  auditReq(req, 'delete', 'items', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
