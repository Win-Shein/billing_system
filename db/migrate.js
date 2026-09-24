'use strict';

/**
 * Idempotent column/table migrations for changes made after the initial
 * schema.sql was written. schema.sql uses CREATE TABLE IF NOT EXISTS, which
 * does NOT add new columns to a table that already exists on disk — so any
 * column added to an existing table after go-live must be migrated here
 * with ALTER TABLE ... ADD COLUMN, guarded so re-running is always safe.
 */

function columnExists(raw, table, column) {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function addColumn(raw, table, column, definition) {
  if (!columnExists(raw, table, column)) {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(raw) {
  /* ---- invoices: German tax compliance / GoBD fields ------------------ */
  addColumn(raw, 'invoices', 'issuer_tax_number', 'TEXT');
  addColumn(raw, 'invoices', 'client_country', "TEXT NOT NULL DEFAULT 'Myanmar'");
  addColumn(raw, 'invoices', 'service_period_start', 'TEXT');
  addColumn(raw, 'invoices', 'service_period_end', 'TEXT');
  addColumn(raw, 'invoices', 'vat_rate', 'REAL NOT NULL DEFAULT 0');
  addColumn(raw, 'invoices', 'vat_exemption_reason', 'TEXT');
  addColumn(raw, 'invoices', 'is_locked', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(raw, 'invoices', 'original_invoice_id', 'INTEGER REFERENCES invoices(id)');

  /* ---- settings: Kleinunternehmer flag + bank/payment instructions ----- */
  addColumn(raw, 'settings', 'is_kleinunternehmer', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(raw, 'settings', 'bank_name', 'TEXT');
  addColumn(raw, 'settings', 'bank_iban', 'TEXT');
  addColumn(raw, 'settings', 'bank_bic', 'TEXT');
  addColumn(raw, 'settings', 'bank_account_holder', 'TEXT');

  /* ---- payment_settlements: EUR settlement tracking (Zuflussprinzip) --- */
  raw.exec(`
    CREATE TABLE IF NOT EXISTS payment_settlements (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      invoice_id         INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      settlement_date    TEXT    NOT NULL,
      billed_amount      REAL    NOT NULL,
      billed_currency    TEXT    NOT NULL,
      settled_amount_eur REAL    NOT NULL,
      payment_method     TEXT,
      gateway_fee_eur    REAL    NOT NULL DEFAULT 0,
      transaction_ref    TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  raw.exec('CREATE INDEX IF NOT EXISTS idx_settlements_org ON payment_settlements(org_id);');
  raw.exec('CREATE INDEX IF NOT EXISTS idx_settlements_invoice ON payment_settlements(invoice_id);');
  raw.exec('CREATE INDEX IF NOT EXISTS idx_invoices_original ON invoices(original_invoice_id);');

  /* ---- invoice_sequences: per-year sequential invoice numbering --------- */
  raw.exec(`
    CREATE TABLE IF NOT EXISTS invoice_sequences (
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      year   TEXT    NOT NULL,
      next   INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (org_id, year)
    );
  `);

  /* ---- expenses: business costs for German EÜR (Betriebsausgaben) ------- */
  raw.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      expense_date  TEXT    NOT NULL,
      category      TEXT    NOT NULL,
      description   TEXT,
      supplier      TEXT,
      amount_gross  REAL    NOT NULL DEFAULT 0,
      vat_rate      REAL    NOT NULL DEFAULT 0,
      vat_amount    REAL    NOT NULL DEFAULT 0,
      payment_method TEXT,
      document_ref  TEXT,
      notes         TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  raw.exec('CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(org_id);');
  raw.exec('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);');

  /* ---- expenses: GoBD receipt (Beleg) attachment ------------------------- */
  addColumn(raw, 'expenses', 'receipt_name', 'TEXT');
  addColumn(raw, 'expenses', 'receipt_data', 'TEXT');

  /* ---- expense_categories: user-editable EÜR categories ------------------ */
  raw.exec(`
    CREATE TABLE IF NOT EXISTS expense_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, name)
    );
  `);
  raw.exec('CREATE INDEX IF NOT EXISTS idx_expense_categories_org ON expense_categories(org_id);');
}

module.exports = { migrate, columnExists, addColumn };
