-- ============================================================
--  Billing System - SQLite schema (single-user, personal use)
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- Organization (single implicit tenant) ----------
CREATE TABLE IF NOT EXISTS organizations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Users (single user) ----------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  name          TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- ---------- Session store (express-session) ----------
CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  sess    TEXT    NOT NULL,
  expire  INTEGER NOT NULL
);

-- ---------- Company / app settings ----------
CREATE TABLE IF NOT EXISTS settings (
  org_id          INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  company_name    TEXT    NOT NULL DEFAULT 'My Company',
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  city            TEXT,
  country         TEXT,
  tax_number      TEXT,
  steuernummer    TEXT,                             -- German Steuernummer (e.g. 12/345/67890)
  ust_id          TEXT,                             -- USt-IdNr (e.g. DE123456789)
  currency        TEXT    NOT NULL DEFAULT 'EUR',
  currency_symbol TEXT    NOT NULL DEFAULT '€',
  default_tax     REAL    NOT NULL DEFAULT 0,
  invoice_prefix  TEXT    NOT NULL DEFAULT 'INV-',
  invoice_next    INTEGER NOT NULL DEFAULT 1,
  language        TEXT    NOT NULL DEFAULT 'en',
  logo_url        TEXT,
  notes           TEXT,
  -- German tax compliance (Finanzamt / GoBD)
  is_kleinunternehmer INTEGER NOT NULL DEFAULT 0,  -- § 19 UStG small-business regime
  bank_name           TEXT,
  bank_iban           TEXT,
  bank_bic            TEXT,
  bank_account_holder TEXT,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Customers ----------
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  company       TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  city          TEXT,
  country       TEXT,
  tax_number    TEXT,
  notes         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(org_id);

-- ---------- Items / Products ----------
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  sku           TEXT,
  description   TEXT,
  category      TEXT    DEFAULT 'Other',
  billing_cycle TEXT    NOT NULL DEFAULT 'one-time',
  unit          TEXT    DEFAULT 'pcs',
  price         REAL    NOT NULL DEFAULT 0,
  tax_rate      REAL    NOT NULL DEFAULT 0,
  stock         REAL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_org ON items(org_id);

-- ---------- Invoices ----------
CREATE TABLE IF NOT EXISTS invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_no     TEXT    NOT NULL,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  issue_date     TEXT    NOT NULL DEFAULT (date('now')),
  due_date       TEXT,
  status         TEXT    NOT NULL DEFAULT 'draft',
  currency       TEXT    NOT NULL DEFAULT 'EUR',
  subtotal       REAL    NOT NULL DEFAULT 0,
  discount       REAL    NOT NULL DEFAULT 0,
  tax_total      REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  amount_paid    REAL    NOT NULL DEFAULT 0,
  notes          TEXT,
  terms          TEXT,
  -- German tax compliance (Finanzamt / GoBD / UStG / cross-border to Myanmar)
  issuer_tax_number     TEXT,                          -- Steuernummer snapshot at issue time
  issuer_ust_id         TEXT,                          -- USt-IdNr snapshot at issue time
  client_country        TEXT    NOT NULL DEFAULT 'Myanmar',
  service_period_start  TEXT,                          -- Leistungszeitraum start
  service_period_end    TEXT,                          -- Leistungszeitraum end
  vat_rate              REAL    NOT NULL DEFAULT 0,     -- percentage, e.g. 0.00 for Drittland exports
  vat_exemption_reason  TEXT,                           -- legal clause printed on the PDF
  is_locked             INTEGER NOT NULL DEFAULT 0,     -- GoBD immutability once issued
  original_invoice_id   INTEGER REFERENCES invoices(id), -- set on a Stornorechnung (credit note)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, invoice_no)
);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
-- NOTE: the idx_invoices_original index (on original_invoice_id) is created
-- by db/migrate.js instead, since that column may not exist yet on an
-- already-deployed database at the time this file runs (migrations run
-- after this schema.sql, once the column has definitely been added).

-- ---------- Invoice line items ----------
CREATE TABLE IF NOT EXISTS invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id       INTEGER REFERENCES items(id),
  description   TEXT    NOT NULL,
  quantity      REAL    NOT NULL DEFAULT 1,
  unit_price    REAL    NOT NULL DEFAULT 0,
  tax_rate      REAL    NOT NULL DEFAULT 0,
  line_total    REAL    NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ---------- Payments ----------
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount        REAL    NOT NULL,
  method        TEXT    NOT NULL DEFAULT 'cash',
  reference     TEXT,
  paid_at       TEXT    NOT NULL DEFAULT (date('now')),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(org_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- ---------- Payment settlements (EUR inflow tracking — Zuflussprinzip / EÜR) ----------
-- Separate from `payments` (which track amounts against the invoice balance in the
-- billed currency). This table records the actual bank-credited EUR amount used for
-- German income tax reporting, including gateway fees as deductible expenses.
CREATE TABLE IF NOT EXISTS payment_settlements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id         INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  settlement_date    TEXT    NOT NULL,              -- Zuflussdatum (date credited)
  billed_amount      REAL    NOT NULL,
  billed_currency    TEXT    NOT NULL,
  settled_amount_eur REAL    NOT NULL,               -- reported to Finanzamt
  payment_method     TEXT,                           -- 'Wise', 'Bank Transfer', 'Stripe', ...
  gateway_fee_eur    REAL    NOT NULL DEFAULT 0,      -- deductible Betriebsausgabe
  exchange_rate      REAL,                            -- billed_currency → EUR rate (documentation)
  transaction_ref    TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_settlements_org ON payment_settlements(org_id);
CREATE INDEX IF NOT EXISTS idx_settlements_invoice ON payment_settlements(invoice_id);

-- ---------- Invoice numbering (per-year sequence, INV-YYYY-XXXX) ----------
-- Drafts never consume a number; a number is reserved only at issue time so
-- the legal sequence for each calendar year stays gapless (GoBD).
CREATE TABLE IF NOT EXISTS invoice_sequences (
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year   TEXT    NOT NULL,
  next   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, year)
);

-- ---------- Expenses (German EÜR — Betriebsausgaben) ----------
-- Business costs recorded in EUR for the Einnahmenüberschussrechnung.
-- `amount_gross` is what actually left the account (Abfluss), `vat_amount`
-- the Vorsteuer portion. Categories mirror the standard Kontenrahmen
-- (see lib/euerCategories.js).
CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expense_date   TEXT    NOT NULL,                -- Abflussdatum (date paid)
  category       TEXT    NOT NULL,                -- EÜR / Kontenrahmen category
  description    TEXT,
  supplier       TEXT,                            -- Lieferant
  amount_gross   REAL    NOT NULL DEFAULT 0,       -- Brutto in EUR (what left the account)
  vat_rate       REAL    NOT NULL DEFAULT 0,       -- VAT %
  vat_amount     REAL    NOT NULL DEFAULT 0,       -- Vorsteuer portion
  original_currency TEXT NOT NULL DEFAULT 'EUR',   -- currency actually paid in (SGD, USD, ...)
  original_amount   REAL,                          -- gross amount in original_currency
  exchange_rate     REAL,                          -- original_currency → EUR rate
  payment_method TEXT,
  document_ref   TEXT,                            -- Belegnummer / receipt reference (GoBD)
  receipt_name   TEXT,                            -- original receipt filename (Beleg)
  receipt_data   TEXT,                            -- receipt as a data URI (image/PDF)
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(org_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- ---------- Expense categories (user-editable EÜR) ----------
-- Seeded with the default Kontenrahmen-style list (see lib/euerCategories.js)
-- on first use; the user can then add, rename or delete their own categories.
CREATE TABLE IF NOT EXISTS expense_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, name)
);
CREATE INDEX IF NOT EXISTS idx_expense_categories_org ON expense_categories(org_id);

-- ---------- Audit log (GoBD Nachvollziehbarkeit / traceability) ----------
-- Records who changed what and when across all business entities, so the
-- history of the books can be reconstructed for a tax audit.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_email TEXT,
  action     TEXT    NOT NULL,              -- create / update / delete / issue / cancel
  entity     TEXT    NOT NULL,              -- invoices / expenses / customers / ...
  entity_id  INTEGER,
  details    TEXT,                          -- JSON summary of the change
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(org_id, entity, entity_id);
