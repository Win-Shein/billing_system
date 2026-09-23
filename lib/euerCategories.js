'use strict';

/**
 * German EÜR (Einnahmenüberschussrechnung) helpers.
 *
 * The default expense categories are loosely modelled on the standard
 * Kontenrahmen (SKR03/SKR04) groupings a freelancer or small agency would
 * use. They are seeded per-organization into the `expense_categories` table
 * on first use, after which the user can add, rename or delete their own.
 */

const DEFAULT_EXPENSE_CATEGORIES = [
  'Webhosting & Domains',
  'Software & Abonnements',
  'Hardware & Ausstattung',
  'Büro & Arbeitsraum',
  'Steuerberater & Dienstleistungen',
  'Gebühren & Provisionen',
  'Reisekosten',
  'Werbung & Marketing',
  'Fortbildung',
  'Telefon & Internet',
  'Versicherungen',
  'Sonstige',
];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Vorsteuer portion of a Brutto expense. VAT is assumed to be included in
 * the gross amount (standard for EU/B2B receipts): vat = gross * rate / (100 + rate).
 */
function expenseVatAmount(amountGross, vatRate) {
  const r = Number(vatRate) || 0;
  return r > 0 ? round2(amountGross * r / (100 + r)) : 0;
}

/**
 * Betriebsausgabe (deductible) amount:
 *  - Kleinunternehmer (§ 19 UStG): cannot reclaim Vorsteuer → full gross.
 *  - otherwise: only the net (gross − Vorsteuer) is deductible.
 */
function deductibleExpense(amountGross, vatAmount, isKleinunternehmer) {
  return isKleinunternehmer ? round2(amountGross) : round2(amountGross - vatAmount);
}

module.exports = { DEFAULT_EXPENSE_CATEGORIES, round2, expenseVatAmount, deductibleExpense };
