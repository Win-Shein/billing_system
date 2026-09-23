'use strict';

/*
 * German EÜR (expense) helper tests — pure functions from lib/euerCategories.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_EXPENSE_CATEGORIES, expenseVatAmount, deductibleExpense,
} = require('../lib/euerCategories');

test('categories: default Kontenrahmen-style list is present', () => {
  assert.strictEqual(DEFAULT_EXPENSE_CATEGORIES.length, 12);
  assert.ok(DEFAULT_EXPENSE_CATEGORIES.includes('Webhosting & Domains'));
  assert.ok(DEFAULT_EXPENSE_CATEGORIES.includes('Gebühren & Provisionen'));
  assert.ok(DEFAULT_EXPENSE_CATEGORIES.includes('Sonstige'));
});

test('expense VAT: included in gross (19%)', () => {
  // 119.00 gross at 19% → 19.00 VAT
  assert.strictEqual(expenseVatAmount(119, 19), 19);
});

test('expense VAT: 0% → 0 VAT', () => {
  assert.strictEqual(expenseVatAmount(100, 0), 0);
});

test('expense VAT: 7% reduced rate', () => {
  // 107 gross at 7% → 7 VAT
  assert.strictEqual(expenseVatAmount(107, 7), 7);
});

test('deductible: Kleinunternehmer deducts full gross', () => {
  assert.strictEqual(deductibleExpense(119, 19, true), 119);
});

test('deductible: VAT-registered deducts net (gross − Vorsteuer)', () => {
  assert.strictEqual(deductibleExpense(119, 19, false), 100);
});
