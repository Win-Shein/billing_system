'use strict';

const express = require('express');
const db = require('../db/database');

const router = express.Router();

// List audit entries, optionally filtered by entity / entity_id.
router.get('/', (req, res) => {
  const { entity, entity_id } = req.query;
  const clauses = ['a.org_id = @org'];
  const params = { org: req.orgId };
  if (entity) { clauses.push('a.entity = @entity'); params.entity = entity; }
  if (entity_id) { clauses.push('a.entity_id = @entity_id'); params.entity_id = entity_id; }

  const rows = db
    .prepare(
      `SELECT a.* FROM audit_log a
        WHERE ${clauses.join(' AND ')}
        ORDER BY a.id DESC
        LIMIT 500`
    )
    .all(params);
  res.json(rows);
});

module.exports = router;
