'use strict';

const express = require('express');
const db = require('../db/database');
const { round2, deductibleExpense } = require('../lib/euerCategories');

const router = express.Router();

// Revenue / collections over a date range grouped by month
router.get('/revenue', (req, res) => {
  const org = req.orgId;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';

  const invoiced = db
    .prepare(
      `SELECT strftime('%Y-%m', issue_date) AS month,
              COUNT(*) AS invoices, COALESCE(SUM(total),0) AS billed
         FROM invoices
        WHERE org_id = ? AND status != 'void' AND issue_date BETWEEN ? AND ?
        GROUP BY month ORDER BY month`
    )
    .all(org, from, to);

  const collected = db
    .prepare(
      `SELECT strftime('%Y-%m', paid_at) AS month, COALESCE(SUM(amount),0) AS collected
         FROM payments WHERE org_id = ? AND paid_at BETWEEN ? AND ?
        GROUP BY month ORDER BY month`
    )
    .all(org, from, to);

  res.json({ from, to, invoiced, collected });
});

// Outstanding / receivables aging (optional issue-date range filter)
router.get('/aging', (req, res) => {
  const org = req.orgId;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const rows = db
    .prepare(
      `SELECT i.id, i.invoice_no, i.issue_date, i.due_date, i.total, i.amount_paid,
              (i.total - i.amount_paid) AS balance, c.name AS customer_name,
              CAST(julianday('now') - julianday(i.due_date) AS INTEGER) AS days_overdue
         FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.org_id = ? AND i.status NOT IN ('paid','void') AND (i.total - i.amount_paid) > 0
          AND i.issue_date BETWEEN ? AND ?
        ORDER BY i.due_date`
    )
    .all(org, from, to);

  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const r of rows) {
    const d = r.days_overdue || 0;
    if (d <= 0) buckets.current += r.balance;
    else if (d <= 30) buckets.d1_30 += r.balance;
    else if (d <= 60) buckets.d31_60 += r.balance;
    else if (d <= 90) buckets.d61_90 += r.balance;
    else buckets.d90_plus += r.balance;
  }
  res.json({ rows, buckets });
});

// Monthly summary — billed / collected / outstanding per month
router.get('/monthly', (req, res) => {
  const org = req.orgId;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', issue_date) AS month,
              COUNT(*) AS invoices,
              COALESCE(SUM(total),0) AS billed,
              COALESCE(SUM(amount_paid),0) AS collected,
              COALESCE(SUM(total - amount_paid),0) AS outstanding
         FROM invoices
        WHERE org_id = ? AND status != 'void' AND issue_date BETWEEN ? AND ?
        GROUP BY month ORDER BY month DESC`
    )
    .all(org, from, to);
  const totals = rows.reduce(
    (a, r) => ({
      invoices: a.invoices + r.invoices,
      billed: a.billed + r.billed,
      collected: a.collected + r.collected,
      outstanding: a.outstanding + r.outstanding,
    }),
    { invoices: 0, billed: 0, collected: 0, outstanding: 0 }
  );
  res.json({ from, to, rows, totals });
});

// Sales by item
router.get('/by-item', (req, res) => {
  const rows = db
    .prepare(
      `SELECT COALESCE(it.name, ii.description) AS name,
              SUM(ii.quantity) AS qty,
              SUM(ii.line_total) AS revenue
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id AND i.status != 'void' AND i.org_id = ?
         LEFT JOIN items it ON it.id = ii.item_id
        GROUP BY name ORDER BY revenue DESC LIMIT 50`
    )
    .all(req.orgId);
  res.json(rows);
});

// German tax advisor export (EÜR / Zuflussprinzip) — CSV of settled EUR income
router.get('/tax-export', (req, res) => {
  const org = req.orgId;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';

  const rows = db
    .prepare(
      `SELECT i.invoice_no, i.issue_date, s.settlement_date, c.name AS client_name, i.client_country,
              s.billed_amount, s.billed_currency, s.settled_amount_eur, s.gateway_fee_eur,
              i.vat_exemption_reason
         FROM payment_settlements s
         JOIN invoices i ON i.id = s.invoice_id
         JOIN customers c ON c.id = i.customer_id
        WHERE s.org_id = ? AND s.settlement_date BETWEEN ? AND ?
        ORDER BY s.settlement_date, s.id`
    )
    .all(org, from, to);

  const headers = [
    'Invoice Number', 'Issue Date', 'Settlement Date (Zuflussdatum)', 'Client Name', 'Country',
    'Billed Amount & Currency', 'Taxable Income in EUR', 'Gateway Fee in EUR', 'Tax Reference Clause',
  ];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(cell).join(',')];
  let totalEur = 0, totalFee = 0;
  for (const r of rows) {
    totalEur += r.settled_amount_eur;
    totalFee += r.gateway_fee_eur;
    lines.push([
      r.invoice_no, r.issue_date, r.settlement_date, r.client_name, r.client_country,
      `${r.billed_amount} ${r.billed_currency}`, r.settled_amount_eur.toFixed(2), r.gateway_fee_eur.toFixed(2),
      r.vat_exemption_reason || '',
    ].map(cell).join(','));
  }
  lines.push(['', '', '', '', '', 'TOTAL', totalEur.toFixed(2), totalFee.toFixed(2), ''].map(cell).join(','));

  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tax-export_${from}_${to}.csv"`);
  res.send(csv);
});

// JSON summary of the EÜR position (income, expenses, profit) for the UI.
router.get('/euer-summary', (req, res) => {
  const org = req.orgId;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';

  const settings = db.prepare('SELECT is_kleinunternehmer FROM settings WHERE org_id = ?').get(org);
  const klein = !!settings?.is_kleinunternehmer;

  const incomeRow = db
    .prepare(
      `SELECT COALESCE(SUM(settled_amount_eur),0) AS income, COALESCE(SUM(gateway_fee_eur),0) AS fees
         FROM payment_settlements WHERE org_id = ? AND settlement_date BETWEEN ? AND ?`
    )
    .get(org, from, to);

  const expRows = db
    .prepare('SELECT amount_gross, vat_amount FROM expenses WHERE org_id = ? AND expense_date BETWEEN ? AND ?')
    .all(org, from, to);

  let expenses = 0;
  for (const r of expRows) expenses += deductibleExpense(r.amount_gross, r.vat_amount, klein);
  expenses = round2(expenses + (incomeRow.fees || 0));

  const income = round2(incomeRow.income || 0);
  const profit = round2(income - expenses);

  res.json({ from, to, income, gatewayFees: round2(incomeRow.fees || 0), expenses, profit, klein });
});

// Full EÜR export: income (Einnahmen) + expenses (Betriebsausgaben) + profit.
// Income comes from payment_settlements (Zuflussprinzip); gateway fees are
// treated as a deductible expense. Expenses come from the `expenses` table.
// Deductible expense basis depends on the VAT regime: a Kleinunternehmer
// (§ 19 UStG) cannot reclaim Vorsteuer, so the full gross is deductible;
// otherwise only the net (gross − Vorsteuer) is a Betriebsausgabe.
router.get('/euer-export', (req, res) => {
  const org = req.orgId;
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';

  const settings = db.prepare('SELECT is_kleinunternehmer FROM settings WHERE org_id = ?').get(org);
  const klein = !!settings?.is_kleinunternehmer;

  const income = db
    .prepare(
      `SELECT s.settlement_date AS d, i.invoice_no AS ref, c.name AS party,
              s.settled_amount_eur AS amount, s.gateway_fee_eur AS fee
         FROM payment_settlements s
         JOIN invoices i ON i.id = s.invoice_id
         JOIN customers c ON c.id = i.customer_id
        WHERE s.org_id = ? AND s.settlement_date BETWEEN ? AND ?
        ORDER BY s.settlement_date, s.id`
    )
    .all(org, from, to);

  const expenses = db
    .prepare(
      `SELECT expense_date AS d, document_ref AS ref, supplier AS party, description,
              amount_gross, vat_amount, category
         FROM expenses
        WHERE org_id = ? AND expense_date BETWEEN ? AND ?
        ORDER BY expense_date, id`
    )
    .all(org, from, to);

  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [];

  lines.push(['EÜR — Einnahmenüberschussrechnung', '', '', ''].map(cell).join(','));
  lines.push([`Zeitraum: ${from} – ${to}`, '', '', ''].map(cell).join(','));
  lines.push(['', '', '', ''].map(cell).join(','));

  // Income section
  lines.push(['EINNAHMEN (income)', '', '', ''].map(cell).join(','));
  lines.push(['Date', 'Invoice', 'Client', 'Income (EUR)'].map(cell).join(','));
  let incomeTotal = 0, feeTotal = 0;
  for (const r of income) {
    incomeTotal += r.amount;
    feeTotal += r.fee;
    lines.push([r.d, r.ref, r.party, r.amount.toFixed(2)].map(cell).join(','));
  }
  lines.push(['', '', 'Subtotal income', incomeTotal.toFixed(2)].map(cell).join(','));

  // Expenses section
  lines.push(['', '', '', ''].map(cell).join(','));
  lines.push(['BETRIEBSAUSGABEN (expenses)', '', '', ''].map(cell).join(','));
  lines.push(['Date', 'Category', 'Supplier / Description', 'Expense (EUR)'].map(cell).join(','));
  let expenseTotal = 0;
  for (const r of expenses) {
    const deductible = deductibleExpense(r.amount_gross, r.vat_amount, klein);
    expenseTotal += deductible;
    const desc = [r.party, r.description].filter(Boolean).join(' — ');
    lines.push([r.d, r.category, desc, deductible.toFixed(2)].map(cell).join(','));
  }
  if (feeTotal > 0) {
    expenseTotal += feeTotal;
    lines.push(['', 'fees', 'Payment gateway fees', feeTotal.toFixed(2)].map(cell).join(','));
  }
  lines.push(['', '', 'Subtotal expenses', expenseTotal.toFixed(2)].map(cell).join(','));

  // Profit
  const profit = round2(incomeTotal - expenseTotal);
  lines.push(['', '', '', ''].map(cell).join(','));
  lines.push(['GEWINN (profit)', '', '', profit.toFixed(2)].map(cell).join(','));
  lines.push([klein ? 'Basis: Kleinunternehmer (§ 19 UStG) — gross expenses deductible' : 'Basis: Vorsteuerabzug — net expenses deductible', '', '', ''].map(cell).join(','));

  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="euer-export_${from}_${to}.csv"`);
  res.send(csv);
});

module.exports = router;
