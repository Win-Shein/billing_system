'use strict';

const express = require('express');
const db = require('../db/database');
const { DEFAULT_EXPENSE_CATEGORIES } = require('../lib/euerCategories');
const { auditReq } = require('../lib/audit');

const router = express.Router();

// Ensure the org has at least the default categories (idempotent).
function seedDefaults(orgId) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM expense_categories WHERE org_id = ?').get(orgId).n;
  if (n > 0) return;
  const insert = db.prepare('INSERT INTO expense_categories (org_id, name) VALUES (?, ?)');
  for (const name of DEFAULT_EXPENSE_CATEGORIES) insert.run(orgId, name);
}

router.get('/', (req, res) => {
  seedDefaults(req.orgId);
  const rows = db
    .prepare('SELECT * FROM expense_categories WHERE org_id = ? ORDER BY name COLLATE NOCASE')
    .all(req.orgId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const dup = db
    .prepare('SELECT id FROM expense_categories WHERE org_id = ? AND name = ? COLLATE NOCASE')
    .get(req.orgId, name);
  if (dup) return res.status(409).json({ error: 'Category already exists' });
  const info = db.prepare('INSERT INTO expense_categories (org_id, name) VALUES (?, ?)').run(req.orgId, name);
  auditReq(req, 'create', 'expense_categories', info.lastInsertRowid, { name });
  res.status(201).json(db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM expense_categories WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const dup = db
    .prepare('SELECT id FROM expense_categories WHERE org_id = ? AND name = ? COLLATE NOCASE AND id != ?')
    .get(req.orgId, name, req.params.id);
  if (dup) return res.status(409).json({ error: 'Category already exists' });

  db.transaction(() => {
    db.prepare('UPDATE expense_categories SET name = ? WHERE id = ? AND org_id = ?').run(name, req.params.id, req.orgId);
    // Keep existing expense rows pointing at the old name in sync.
    db.prepare('UPDATE expenses SET category = ? WHERE org_id = ? AND category = ?').run(name, req.orgId, existing.name);
  })();

  auditReq(req, 'update', 'expense_categories', req.params.id, { from: existing.name, to: name });
  res.json(db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM expense_categories WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const used = db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE org_id = ? AND category = ?').get(req.orgId, existing.name);
  if (used.n > 0) {
    return res.status(409).json({ error: 'Cannot delete: this category is used by expenses' });
  }
  db.prepare('DELETE FROM expense_categories WHERE id = ? AND org_id = ?').run(req.params.id, req.orgId);
  auditReq(req, 'delete', 'expense_categories', req.params.id, { name: existing.name });
  res.json({ ok: true });
});

module.exports = router;
