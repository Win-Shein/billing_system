'use strict';

/**
 * Audit log helper — GoBD Nachvollziehbarkeit (traceability). Every
 * create/update/delete/issue/cancel of business data is recorded so the
 * history of the books can be reconstructed for a tax audit.
 */

const db = require('../db/database');

function audit(orgId, userEmail, action, entity, entityId, details) {
  db.prepare(
    `INSERT INTO audit_log (org_id, user_email, action, entity, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(orgId, userEmail || null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null);
}

/** Convenience wrapper that pulls org/user from an Express request. */
function auditReq(req, action, entity, entityId, details) {
  audit(req.orgId, req.user ? req.user.email : null, action, entity, entityId, details);
}

module.exports = { audit, auditReq };
