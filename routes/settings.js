'use strict';

const express = require('express');
const db = require('../db/database');
const { auditReq } = require('../lib/audit');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM settings WHERE org_id = ?').get(req.orgId));
});

router.put('/', (req, res) => {
  const cur = db.prepare('SELECT * FROM settings WHERE org_id = ?').get(req.orgId);
  const b = req.body;
  db.prepare(
    `UPDATE settings SET
       company_name=@company_name, email=@email, phone=@phone, address=@address,
       city=@city, country=@country, tax_number=@tax_number, steuernummer=@steuernummer, ust_id=@ust_id,
       currency=@currency, currency_symbol=@currency_symbol, default_tax=@default_tax, invoice_prefix=@invoice_prefix,
       invoice_next=@invoice_next, language=@language, logo_url=@logo_url, notes=@notes,
       is_kleinunternehmer=@is_kleinunternehmer, bank_name=@bank_name, bank_iban=@bank_iban,
       bank_bic=@bank_bic, bank_account_holder=@bank_account_holder,
       updated_at=datetime('now')
     WHERE org_id = @org`
  ).run({
    org: req.orgId,
    company_name: b.company_name ?? cur.company_name,
    email: b.email ?? cur.email,
    phone: b.phone ?? cur.phone,
    address: b.address ?? cur.address,
    city: b.city ?? cur.city,
    country: b.country ?? cur.country,
    tax_number: b.tax_number ?? cur.tax_number,
    steuernummer: b.steuernummer ?? cur.steuernummer,
    ust_id: b.ust_id ?? cur.ust_id,
    currency: b.currency ?? cur.currency,
    currency_symbol: b.currency_symbol ?? cur.currency_symbol,
    default_tax: b.default_tax != null ? Number(b.default_tax) : cur.default_tax,
    invoice_prefix: b.invoice_prefix ?? cur.invoice_prefix,
    invoice_next: b.invoice_next != null ? Number(b.invoice_next) : cur.invoice_next,
    language: b.language ?? cur.language,
    logo_url: b.logo_url ?? cur.logo_url,
    notes: b.notes ?? cur.notes,
    is_kleinunternehmer: b.is_kleinunternehmer != null ? (b.is_kleinunternehmer ? 1 : 0) : cur.is_kleinunternehmer,
    bank_name: b.bank_name ?? cur.bank_name,
    bank_iban: b.bank_iban ?? cur.bank_iban,
    bank_bic: b.bank_bic ?? cur.bank_bic,
    bank_account_holder: b.bank_account_holder ?? cur.bank_account_holder,
  });
  auditReq(req, 'update', 'settings', cur.org_id);
  res.json(db.prepare('SELECT * FROM settings WHERE org_id = ?').get(req.orgId));
});

module.exports = router;
