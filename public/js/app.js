'use strict';

/* ============================================================
   Small framework: fetch helpers, state, DOM utils, router
   ============================================================ */

const API = '/api';
let SETTINGS = { currency_symbol: '€', default_tax: 0, currency: 'EUR' };
let ME = null;   // current authenticated user {id,email,name,org}

const canWrite = () => true;

const CATEGORIES = [
  'VPS', 'VPN', 'Domain', 'Hosting', 'App', 'License',
  'Web Building', 'Web Maintenance', 'Server Maintenance', 'App Maintenance', 'Other',
];
const BILLING_CYCLES = ['one-time', 'monthly', 'quarterly', 'yearly'];

async function api(method, path, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const res = await fetch(API + path, opt);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b);
const put = (p, b) => api('PUT', p, b);
const patch = (p, b) => api('PATCH', p, b);
const del = (p) => api('DELETE', p);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `${SETTINGS.currency_symbol} ${fmt(n)}`;
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg, type = '') {
  const t = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------- Export a table to a CSV/Excel file ---------- */
function exportCSV(filename, headers, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/* ---------- Apply the uploaded logo to the sidebar brand ---------- */
function applyBranding() {
  const brand = $('.brand');
  if (!brand) return;
  if (SETTINGS.logo_url) {
    brand.innerHTML = `<img src="${SETTINGS.logo_url}" alt="logo" class="brand-logo">`;
  } else {
    brand.innerHTML = `<span class="brand-mark">₿</span><span class="brand-name">Billing</span>`;
  }
}

/* ============================================================
   i18n — English / Myanmar
   ============================================================ */
let LANG = localStorage.getItem('lang') || 'en';
const MM = {
  // Nav / titles
  Dashboard: 'ပင်မစာမျက်နှာ', Invoices: 'ငွေတောင်းခံလွှာ', Customers: 'ဖောက်သည်များ',
  Items: 'ပစ္စည်း / ဝန်ဆောင်မှု', Payments: 'ငွေပေးချေမှု', Reports: 'အစီရင်ခံစာ', Settings: 'ဆက်တင်',
  // Dashboard
  'Total Billed': 'စုစုပေါင်း တောင်းခံငွေ', Collected: 'ရရှိပြီး', Outstanding: 'ကျန်ရှိငွေ', Overdue: 'ကျော်လွန်',
  invoices: 'ငွေတောင်းခံလွှာ', 'Collections (last 6 months)': 'ရရှိငွေ (၆ လ)', 'Top Customers': 'ထိပ်တန်း ဖောက်သည်များ',
  'Recent Invoices': 'မကြာသေးမီ လွှာများ', 'No invoices yet': 'လွှာ မရှိသေးပါ', 'No data': 'အချက်အလက် မရှိ',
  // Common headers
  '#': 'စဉ်', 'Invoice #': 'လွှာနံပါတ်', Invoice: 'လွှာ', Customer: 'ဖောက်သည်', Date: 'ရက်စွဲ', Status: 'အခြေအနေ',
  Total: 'စုစုပေါင်း', Balance: 'ကျန်ငွေ', Issue: 'ထုတ်ရက်', Due: 'ပေးရမည့်ရက်', Actions: 'လုပ်ဆောင်ချက်',
  Name: 'အမည်', Contact: 'ဆက်သွယ်ရန်', Category: 'အမျိုးအစား', SKU: 'ကုဒ်', Price: 'ဈေးနှုန်း',
  'Tax %': 'အခွန် %', Stock: 'လက်ကျန်', Method: 'ပေးချေနည်း', Reference: 'ကိုးကား', Amount: 'ပမာဏ', Days: 'ရက်',
  // Buttons
  Save: 'သိမ်းမည်', Cancel: 'မလုပ်တော့', Edit: 'ပြင်', Del: 'ဖျက်', Delete: 'ဖျက်မည်',
  Today: 'ဒီနေ့', 'This Month': 'ဒီလ', 'This Year': 'ဒီနှစ်', 'All Dates': 'ရက်အားလုံး', All: 'အားလုံး',
  '⬇ Export Excel': '⬇ Excel ထုတ်', From: 'မှ', To: 'အထိ',
  '+ New Invoice': '+ လွှာအသစ်', '+ New Customer': '+ ဖောက်သည်အသစ်', '+ New Item / Service': '+ ပစ္စည်း/ဝန်ဆောင်မှု အသစ်',
  // Reports
  'Receivables Aging': 'ကြွေးကျန် သက်တမ်း', 'Top Selling Items': 'ရောင်းအားကောင်း ပစ္စည်း',
  'Monthly Summary (လစဉ်ချုပ်)': 'လစဉ်ချုပ်', 'Overdue / Outstanding Invoices': 'ကျော်လွန် / ကျန်ရှိ လွှာများ',
  Current: 'လက်ရှိ', Month: 'လ', Billed: 'တောင်းခံ', Qty: 'အရေအတွက်', Revenue: 'ဝင်ငွေ', Item: 'ပစ္စည်း',
  // Payments / filters
  'Search…': 'ရှာဖွေရန်…', 'All methods': 'နည်းလမ်းအားလုံး', paypal: 'PayPal', debitcard: 'Debit Card', bank: 'ဘဏ်',
  'No payments yet': 'ငွေပေးချေမှု မရှိသေးပါ',
  // Expenses (EÜR)
  Expenses: 'ကုန်ကျစရိတ်', Expense: 'ကုန်ကျစရိတ်', '+ New Expense': '+ ကုန်ကျစရိတ်အသစ်',
  'New Expense': 'ကုန်ကျစရိတ်အသစ်', 'Edit Expense': 'ကုန်ကျစရိတ် ပြင်ရန်', 'Save Expense': 'ကုန်ကျစရိတ် သိမ်းမည်',
  'Expense Date': 'ကုန်ကျရက်', Supplier: 'ပေးသွင်းသူ', 'Document Ref': 'Beleg နံပါတ်',
  'VAT %': 'VAT %', 'Gross (€)': 'စုစုပေါင်း (€)',
  'EÜR Export': 'EÜR ထုတ်မည်', 'Income (EUR)': 'ဝင်ငွေ (EUR)', 'Expenses (EUR)': 'ကုန်ကျစရိတ် (EUR)',
  'Net Profit': 'အသားတင်အမြတ်', 'Expenses & Profit (EÜR)': 'ကုန်ကျစရိတ် & အမြတ် (EÜR)',
  'Gateway Fees': 'Gateway ကြေး', Categories: 'အမျိုးအစားများ', 'New category name': 'အမျိုးအစားအသစ် အမည်',
  Add: 'ထည့်မည်',
  // Settings
  'Company Logo': 'ကုမ္ပဏီ Logo', 'Company Details': 'ကုမ္ပဏီ အချက်အလက်', 'Billing Preferences': 'ငွေတောင်းခံမှု ဆက်တင်',
  Language: 'ဘာသာစကား', 'Save Settings': 'ဆက်တင် သိမ်းမည်', 'Remove logo': 'Logo ဖယ်ရှား',
  // Status labels
  Draft: 'မူကြမ်း', Sent: 'ပို့ပြီး', Partial: 'တစ်စိတ်တစ်ပိုင်း', Paid: 'ပေးချေပြီး', Void: 'ပယ်ဖျက်',
  // Modal form labels (create / edit)
  'New Customer': 'ဖောက်သည်အသစ်', 'Edit Customer': 'ဖောက်သည် ပြင်ဆင်ရန်',
  'New Item / Service': 'ပစ္စည်း / ဝန်ဆောင်မှု အသစ်', 'Edit Item / Service': 'ပစ္စည်း / ဝန်ဆောင်မှု ပြင်ရန်',
  Company: 'ကုမ္ပဏီ', Email: 'အီးမေးလ်', Phone: 'ဖုန်း', Address: 'လိပ်စာ', City: 'မြို့',
  Country: 'နိုင်ငံ', 'Tax Number': 'အခွန်နံပါတ်', Notes: 'မှတ်ချက်',
  'Billing Cycle': 'ကြေးကောက်ခံ ကာလ', Unit: 'ယူနစ်', Description: 'ဖော်ပြချက်',
  'New Invoice': 'လွှာအသစ်', 'Issue Date': 'ထုတ်သည့်ရက်', 'Due Date': 'ပေးရမည့်ရက်',
  'Item / Description': 'ပစ္စည်း / ဖော်ပြချက်', '+ Add line': '+ အတန်းထည့်', 'Save Invoice': 'လွှာ သိမ်းမည်',
  Subtotal: 'စုစုပေါင်းခွဲ', Discount: 'လျှော့ငွေ', Tax: 'အခွန်', Terms: 'စည်းကမ်းချက်',
  '— select —': '— ရွေးချယ်ပါ —', 'Bill To': 'ငွေတောင်းခံသူ', 'Balance Due': 'ပေးရန်ကျန်ငွေ',
  'Record Payment': 'ငွေပေးချေမှု မှတ်တမ်း', 'Save Payment': 'ငွေပေးချေမှု သိမ်းမည်', 'Payment for': 'ငွေပေးချေမှု —',
  'Add at least one line item': 'အနည်းဆုံး တစ်ကြောင်း ထည့်ပါ', 'Please select a customer': 'ဖောက်သည် ရွေးချယ်ပါ',
  'Name is required': 'အမည် လိုအပ်သည်',
  // Auth / account / plan / admin
  'Team & Plan': 'အဖွဲ့ & Plan', Admin: 'စီမံခန့်ခွဲ', 'Sign in': 'ဝင်ရောက်ရန်', 'Sign up': 'အကောင့်ဖွင့်ရန်',
  'Log out': 'ထွက်ရန်', Password: 'စကားဝှက်', 'Full Name': 'အမည်အပြည့်အစုံ', 'Company Name': 'ကုမ္ပဏီအမည်',
  'Create account': 'အကောင့် ဖန်တီးမည်', 'Already have an account?': 'အကောင့် ရှိပြီးသားလား?',
  'Need an account?': 'အကောင့် အသစ်လိုလား?', 'Welcome back': 'ပြန်လည် ကြိုဆိုပါသည်',
  'Start your free account': 'အခမဲ့ အကောင့် စတင်ပါ', Plan: 'အစီအစဉ်', 'Current Plan': 'လက်ရှိ Plan',
  'Upgrade to Pro': 'Pro သို့ တိုးမြှင့်', 'invoices this month': 'ဤလ ငွေတောင်းခံလွှာ', Unlimited: 'အကန့်အသတ်မဲ့',
  'Team Members': 'အဖွဲ့ဝင်များ', '+ Add User': '+ အသုံးပြုသူ ထည့်', Role: 'အခန်းကဏ္ဍ',
  Owner: 'ပိုင်ရှင်', Staff: 'ဝန်ထမ်း', Viewer: 'ကြည့်ရှုသူ', Active: 'အသုံးပြုနေ', Deactivate: 'ပိတ်ရန်',
  Activate: 'ဖွင့်ရန်', 'Reset Password': 'စကားဝှက် ပြောင်း', Pending: 'စောင့်ဆိုင်း', Approved: 'အတည်ပြုပြီး',
  Rejected: 'ငြင်းပယ်', Approve: 'အတည်ပြု', Reject: 'ငြင်းပယ်', Organizations: 'အဖွဲ့အစည်းများ',
  'Upgrade Requests': 'တိုးမြှင့်ရန် တောင်းဆိုမှုများ', 'Submit Upgrade Request': 'တောင်းဆိုမှု တင်မည်',
  'Payment Method': 'ငွေပေးချေနည်း', 'Transaction Reference': 'ငွေလွှဲ Reference', Months: 'လ',
  'You have reached your plan limit': 'သင့် Plan ကန့်သတ်ချက် ပြည့်ပါပြီ', Free: 'အခမဲ့', Pro: 'Pro',
};
function t(s) { return LANG === 'my' ? (MM[s] || s) : s; }

function applyStaticI18n() {
  document.documentElement.lang = LANG;
  $$('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
}
function setLang(lang) {
  LANG = lang; localStorage.setItem('lang', lang);
  applyStaticI18n();
}

/* ============================================================
   Theme (light / dark)
   ============================================================ */
let THEME = localStorage.getItem('theme') || 'light';
function applyTheme() {
  document.documentElement.setAttribute('data-theme', THEME);
  const btn = $('#theme-toggle');
  if (btn) btn.textContent = THEME === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() { THEME = THEME === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', THEME); applyTheme(); }

/* ============================================================
   Live clock (top bar, every page)
   ============================================================ */
function startClock() {
  const elc = $('#clock');
  if (!elc) return;
  const tick = () => {
    const d = new Date();
    const date = d.toLocaleDateString(LANG === 'my' ? 'my-MM' : 'en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-GB');
    elc.innerHTML = `<span class="clock-date">${date}</span> · <span class="clock-time">${time}</span>`;
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- Modal ---------- */
function openModal({ title, bodyHTML, wide, footHTML }) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal ${wide ? 'wide' : ''}">
        <div class="modal-head"><h2>${esc(title)}</h2><button class="close-x">&times;</button></div>
        <div class="modal-body">${bodyHTML}</div>
        ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}
      </div>
    </div>`);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  $('.close-x', overlay).onclick = closeModal;
  $('#modal-root').appendChild(overlay);
  return overlay;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

/* ---------- Status badge ---------- */
const statusLabel = (s) => t(String(s).charAt(0).toUpperCase() + String(s).slice(1));
const badge = (s) => `<span class="badge ${esc(s)}">${esc(statusLabel(s))}</span>`;

/* ============================================================
   Router
   ============================================================ */
const routes = {};
function route(name, fn) { routes[name] = fn; }

async function navigate(name) {
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $('#page-title').textContent = t(name.charAt(0).toUpperCase() + name.slice(1));
  $('#topbar-actions').innerHTML = '';
  $('#app').classList.remove('nav-open');   // close mobile drawer on navigate
  $('#view').innerHTML = '<div class="empty">Loading…</div>';
  location.hash = name;
  try {
    await (routes[name] || routes.dashboard)();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
  }
}

$$('.nav-link').forEach((a) => a.addEventListener('click', () => navigate(a.dataset.route)));

/* ============================================================
   Dashboard
   ============================================================ */
route('dashboard', async () => {
  const d = await get('/dashboard');
  const tot = d.totals;
  const maxCollected = Math.max(...d.monthly.map((m) => m.collected), 1);

  const bars = d.monthly.map((m) => `
    <div class="bar-col">
      <div class="bar" style="height:${(m.collected / maxCollected) * 130}px" title="${money(m.collected)}"></div>
      <div class="bar-label">${m.month.slice(5)}/${m.month.slice(2, 4)}</div>
    </div>`).join('') || '<div class="empty">No payment data yet</div>';

  $('#view').innerHTML = `
    <div class="stat-grid">
      <div class="card stat-card accent"><div class="label">${t('Total Billed')}</div><div class="value">${money(tot.total_billed)}</div><div class="sub">${tot.invoice_count} ${t('invoices')}</div></div>
      <div class="card stat-card green"><div class="label">${t('Collected')}</div><div class="value">${money(tot.total_collected)}</div></div>
      <div class="card stat-card amber"><div class="label">${t('Outstanding')}</div><div class="value">${money(tot.outstanding)}</div></div>
      <div class="card stat-card red"><div class="label">${t('Overdue')}</div><div class="value">${money(d.overdue.amount)}</div><div class="sub">${d.overdue.n} ${t('invoices')}</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h3 class="card-title">${t('Collections (last 6 months)')}</h3>
        <div class="bars">${bars}</div>
      </div>
      <div class="card">
        <h3 class="card-title">${t('Top Customers')}</h3>
        <table><tbody>
          ${d.topCustomers.map((c) => `<tr><td>${esc(c.name)}</td><td class="num mono">${money(c.billed)}</td></tr>`).join('') || `<tr><td class="muted">${t('No data')}</td></tr>`}
        </tbody></table>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <h3 class="card-title">${t('Recent Invoices')}</h3>
      <table>
        <thead><tr><th>${t('Invoice')}</th><th>${t('Customer')}</th><th>${t('Date')}</th><th>${t('Status')}</th><th class="num">${t('Total')}</th></tr></thead>
        <tbody>
          ${d.recentInvoices.map((i) => `
            <tr>
              <td><a class="link" data-inv="${i.id}">${esc(i.invoice_no)}</a></td>
              <td>${esc(i.customer_name)}</td>
              <td>${esc(i.issue_date)}</td>
              <td>${badge(i.status)}</td>
              <td class="num mono">${money(i.total)}</td>
            </tr>`).join('') || `<tr><td colspan="5" class="muted">${t('No invoices yet')}</td></tr>`}
        </tbody>
      </table>
    </div>`;

  $$('[data-inv]').forEach((a) => a.onclick = () => viewInvoice(a.dataset.inv));
});

/* ============================================================
   Customers
   ============================================================ */
route('customers', async () => {
  $('#topbar-actions').innerHTML = canWrite() ? `<button class="btn btn-primary" id="add-cust">${t('+ New Customer')}</button>` : '';
  const add = $('#add-cust'); if (add) add.onclick = () => editCustomer();
  await renderCustomers();
});

async function renderCustomers(search = '') {
  const rows = await get('/customers?search=' + encodeURIComponent(search));
  $('#view').innerHTML = `
    <div class="toolbar">
      <input class="search" id="cust-search" placeholder="${t('Search…')}" value="${esc(search)}">
      <span class="spacer"></span>
      <button class="btn btn-sm" id="cust-export">${t('⬇ Export Excel')}</button>
    </div>
    <div class="table-wrap">
      <table class="grid-table">
        <thead><tr><th class="num" style="width:44px">${t('#')}</th><th>${t('Name')}</th><th>${t('Contact')}</th><th class="num">${t('Invoices')}</th><th class="num">${t('Billed')}</th><th class="num">${t('Outstanding')}</th><th style="width:120px">${t('Actions')}</th></tr></thead>
        <tbody>
          ${rows.map((c, idx) => `
            <tr>
              <td class="num muted">${idx + 1}</td>
              <td><strong>${esc(c.name)}</strong>${c.company ? `<div class="muted">${esc(c.company)}</div>` : ''}</td>
              <td>${esc(c.email || '')}${c.phone ? `<div class="muted">${esc(c.phone)}</div>` : ''}</td>
              <td class="num">${c.invoice_count}</td>
              <td class="num mono">${money(c.total_billed)}</td>
              <td class="num mono">${money(c.outstanding)}</td>
              <td class="num" style="white-space:nowrap">
                ${canWrite() ? `<button class="btn btn-sm" data-edit="${c.id}">✏️</button>
                <button class="btn btn-sm btn-danger" data-del="${c.id}">🗑️</button>` : '<span class="muted">—</span>'}
              </td>
            </tr>`).join('') || `<tr><td colspan="7" class="empty">${t('No data')}</td></tr>`}
        </tbody>
      </table>
    </div>`;
  $('#cust-export').onclick = () => exportCSV('customers.csv',
    ['#', 'Name', 'Company', 'Email', 'Phone', 'Invoices', 'Billed', 'Outstanding'],
    rows.map((c, idx) => [idx + 1, c.name, c.company || '', c.email || '', c.phone || '', c.invoice_count, c.total_billed, c.outstanding]));

  let timer;
  $('#cust-search').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => renderCustomers(e.target.value), 250); };
  $$('[data-edit]').forEach((b) => b.onclick = () => editCustomer(b.dataset.edit));
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this customer?')) return;
    try { await del('/customers/' + b.dataset.del); toast('Customer deleted', 'success'); renderCustomers(search); }
    catch (e) { toast(e.message, 'error'); }
  });
}

async function editCustomer(id) {
  const c = id ? await get('/customers/' + id) : {};
  const f = (k) => esc(c[k] || '');
  openModal({
    title: id ? t('Edit Customer') : t('New Customer'),
    bodyHTML: `
      <div class="form-row">
        <div class="field"><label>${t('Name')} *</label><input id="c-name" value="${f('name')}"></div>
        <div class="field"><label>${t('Company')}</label><input id="c-company" value="${f('company')}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>${t('Email')}</label><input id="c-email" value="${f('email')}"></div>
        <div class="field"><label>${t('Phone')}</label><input id="c-phone" value="${f('phone')}"></div>
      </div>
      <div class="field"><label>${t('Address')}</label><input id="c-address" value="${f('address')}"></div>
      <div class="form-row-3">
        <div class="field"><label>${t('City')}</label><input id="c-city" value="${f('city')}"></div>
        <div class="field"><label>${t('Country')}</label><input id="c-country" value="${f('country')}"></div>
        <div class="field"><label>${t('Tax Number')}</label><input id="c-tax" value="${f('tax_number')}"></div>
      </div>
      <div class="field"><label>${t('Notes')}</label><textarea id="c-notes">${f('notes')}</textarea></div>`,
    footHTML: `<button class="btn" id="c-cancel">${t('Cancel')}</button><button class="btn btn-primary" id="c-save">${t('Save')}</button>`,
  });
  $('#c-cancel').onclick = closeModal;
  $('#c-save').onclick = async () => {
    const payload = {
      name: $('#c-name').value, company: $('#c-company').value, email: $('#c-email').value,
      phone: $('#c-phone').value, address: $('#c-address').value, city: $('#c-city').value,
      country: $('#c-country').value, tax_number: $('#c-tax').value, notes: $('#c-notes').value,
    };
    if (!payload.name.trim()) return toast(t('Name is required'), 'error');
    try {
      await (id ? put('/customers/' + id, payload) : post('/customers', payload));
      toast(t('Save'), 'success'); closeModal(); renderCustomers();
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============================================================
   Items
   ============================================================ */
let itemCatFilter = '';
route('items', async () => {
  $('#topbar-actions').innerHTML = canWrite() ? `<button class="btn btn-primary" id="add-item">${t('+ New Item / Service')}</button>` : '';
  const add = $('#add-item'); if (add) add.onclick = () => editItem();
  await renderItems();
});

const cycleBadge = (c) => c && c !== 'one-time' ? `<span class="badge sent" style="margin-left:6px">${esc(c)}</span>` : '';

async function renderItems(search = '') {
  const rows = await get('/items?search=' + encodeURIComponent(search) + '&category=' + encodeURIComponent(itemCatFilter));
  $('#view').innerHTML = `
    <div class="toolbar">
      <input class="search" id="item-search" placeholder="${t('Search…')}" value="${esc(search)}">
      <select id="item-cat" style="max-width:200px">
        <option value="">${t('All')} — ${t('Category')}</option>
        ${CATEGORIES.map((c) => `<option value="${c}" ${itemCatFilter === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="item-export">${t('⬇ Export Excel')}</button>
    </div>
    <div class="table-wrap">
      <table class="grid-table">
        <thead><tr><th class="num" style="width:44px">${t('#')}</th><th>${t('Name')}</th><th>${t('Category')}</th><th>${t('SKU')}</th><th class="num">${t('Price')}</th><th class="num">${t('Tax %')}</th><th class="num">${t('Stock')}</th><th style="width:120px">${t('Actions')}</th></tr></thead>
        <tbody>
          ${rows.map((i, idx) => `
            <tr>
              <td class="num muted">${idx + 1}</td>
              <td><strong>${esc(i.name)}</strong>${cycleBadge(i.billing_cycle)}${i.description ? `<div class="muted">${esc(i.description)}</div>` : ''}</td>
              <td>${esc(i.category || 'Other')}</td>
              <td>${esc(i.sku || '')}</td>
              <td class="num mono">${money(i.price)}</td>
              <td class="num">${i.tax_rate}%</td>
              <td class="num">${i.stock == null ? '<span class="muted">—</span>' : i.stock}</td>
              <td class="num" style="white-space:nowrap">
                ${canWrite() ? `<button class="btn btn-sm" data-edit="${i.id}">✏️</button>
                <button class="btn btn-sm btn-danger" data-del="${i.id}">🗑️</button>` : '<span class="muted">—</span>'}
              </td>
            </tr>`).join('') || `<tr><td colspan="8" class="empty">${t('No data')}</td></tr>`}
        </tbody>
      </table>
    </div>`;
  $('#item-export').onclick = () => exportCSV('items.csv',
    ['#', 'Name', 'Category', 'Billing Cycle', 'SKU', 'Price', 'Tax %', 'Stock'],
    rows.map((i, idx) => [idx + 1, i.name, i.category || '', i.billing_cycle, i.sku || '', i.price, i.tax_rate, i.stock ?? '']));
  let timer;
  $('#item-search').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => renderItems(e.target.value), 250); };
  $('#item-cat').onchange = (e) => { itemCatFilter = e.target.value; renderItems(search); };
  $$('[data-edit]').forEach((b) => b.onclick = () => editItem(b.dataset.edit));
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this item?')) return;
    await del('/items/' + b.dataset.del); toast('Deleted', 'success'); renderItems(search);
  });
}

async function editItem(id) {
  const it = id ? await get('/items/' + id) : { tax_rate: SETTINGS.default_tax, unit: 'pcs', category: 'VPS', billing_cycle: 'monthly' };
  const f = (k) => esc(it[k] ?? '');
  openModal({
    title: id ? t('Edit Item / Service') : t('New Item / Service'),
    bodyHTML: `
      <div class="field"><label>${t('Name')} *</label><input id="i-name" value="${f('name')}"></div>
      <div class="form-row">
        <div class="field"><label>${t('Category')}</label>
          <select id="i-cat">${CATEGORIES.map((c) => `<option ${it.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
        <div class="field"><label>${t('Billing Cycle')}</label>
          <select id="i-cycle">${BILLING_CYCLES.map((c) => `<option ${it.billing_cycle === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>${t('SKU')}</label><input id="i-sku" value="${f('sku')}"></div>
        <div class="field"><label>${t('Unit')}</label><input id="i-unit" value="${f('unit')}"></div>
      </div>
      <div class="form-row-3">
        <div class="field"><label>${t('Price')} (${SETTINGS.currency_symbol})</label><input id="i-price" type="number" step="0.01" value="${f('price')}"></div>
        <div class="field"><label>${t('Tax %')}</label><input id="i-tax" type="number" step="0.01" value="${f('tax_rate')}"></div>
        <div class="field"><label>${t('Stock')}</label><input id="i-stock" type="number" step="0.01" value="${it.stock ?? ''}"></div>
      </div>
      <div class="field"><label>${t('Description')}</label><textarea id="i-desc">${f('description')}</textarea></div>`,
    footHTML: `<button class="btn" id="i-cancel">${t('Cancel')}</button><button class="btn btn-primary" id="i-save">${t('Save')}</button>`,
  });
  $('#i-cancel').onclick = closeModal;
  $('#i-save').onclick = async () => {
    const payload = {
      name: $('#i-name').value, sku: $('#i-sku').value, unit: $('#i-unit').value,
      category: $('#i-cat').value, billing_cycle: $('#i-cycle').value,
      price: $('#i-price').value, tax_rate: $('#i-tax').value, stock: $('#i-stock').value,
      description: $('#i-desc').value,
    };
    if (!payload.name.trim()) return toast(t('Name is required'), 'error');
    try {
      await (id ? put('/items/' + id, payload) : post('/items', payload));
      toast(t('Save'), 'success'); closeModal(); renderItems();
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============================================================
   Expenses (EÜR / Betriebsausgaben)
   ============================================================ */
let expenseCategories = [];
async function loadExpenseCategories() {
  expenseCategories = await get('/expense-categories');
  return expenseCategories;
}

let expCatFilter = '';
let expFrom = '';
let expTo = '';

route('expenses', async () => {
  $('#topbar-actions').innerHTML = canWrite() ? `
    <button class="btn" id="manage-cats">⚙️ ${t('Categories')}</button>
    <button class="btn btn-primary" id="add-exp">${t('+ New Expense')}</button>` : '';
  const add = $('#add-exp'); if (add) add.onclick = () => editExpense();
  const mc = $('#manage-cats'); if (mc) mc.onclick = () => manageExpenseCategories();
  await renderExpenses();
});

async function renderExpenses() {
  await loadExpenseCategories();
  const qs = new URLSearchParams();
  if (expCatFilter) qs.set('category', expCatFilter);
  if (expFrom) qs.set('from', expFrom);
  if (expTo) qs.set('to', expTo);
  const data = await get('/expenses?' + qs.toString());
  const rows = data.rows;

  $('#view').innerHTML = `
    <div class="toolbar">
      <label class="muted">${t('From')}</label><input type="date" id="exp-from" value="${expFrom}" style="max-width:150px">
      <label class="muted">${t('To')}</label><input type="date" id="exp-to" value="${expTo}" style="max-width:150px">
      <button class="btn btn-sm" id="exp-year">${t('This Year')}</button>
      <button class="btn btn-sm" id="exp-all">${t('All Dates')}</button>
      <select id="exp-cat" style="max-width:220px">
        <option value="">${t('All')} — ${t('Category')}</option>
        ${expenseCategories.map((c) => `<option value="${esc(c.name)}" ${expCatFilter === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="exp-export">${t('⬇ Export Excel')}</button>
    </div>
    <div class="table-wrap">
      <table class="grid-table">
        <thead><tr><th class="num" style="width:44px">${t('#')}</th><th>${t('Date')}</th><th>${t('Category')}</th><th>${t('Description')}</th><th>${t('Supplier')}</th><th class="num">${t('VAT %')}</th><th class="num">${t('Amount')} (€)</th><th style="width:120px">${t('Actions')}</th></tr></thead>
        <tbody>
          ${rows.map((e, idx) => `
            <tr>
              <td class="num muted">${idx + 1}</td>
              <td>${esc(e.expense_date)}</td>
              <td>${esc(e.category)}</td>
              <td>${esc(e.description || '')}</td>
              <td>${esc(e.supplier || '')}</td>
              <td class="num">${e.vat_rate}%</td>
              <td class="num mono">€ ${fmt(e.amount_gross)}</td>
              <td class="num" style="white-space:nowrap">
                ${canWrite() ? `<button class="btn btn-sm" data-edit="${e.id}">✏️</button>
                <button class="btn btn-sm btn-danger" data-del="${e.id}">🗑️</button>` : '<span class="muted">—</span>'}
              </td>
            </tr>`).join('') || `<tr><td colspan="8" class="empty">${t('No data')}</td></tr>`}
        </tbody>
        ${rows.length ? `<tfoot><tr><td colspan="6" class="right"><strong>${t('Total')} (${rows.length})</strong></td><td class="num mono"><strong>€ ${fmt(data.totals.gross)}</strong></td><td></td></tr></tfoot>` : ''}
      </table>
    </div>`;

  const reload = () => { expFrom = $('#exp-from').value; expTo = $('#exp-to').value; renderExpenses(); };
  $('#exp-from').onchange = reload;
  $('#exp-to').onchange = reload;
  $('#exp-year').onclick = () => { expFrom = today().slice(0, 4) + '-01-01'; expTo = today(); renderExpenses(); };
  $('#exp-all').onclick = () => { expFrom = ''; expTo = ''; renderExpenses(); };
  $('#exp-cat').onchange = (e) => { expCatFilter = e.target.value; renderExpenses(); };
  $('#exp-export').onclick = () => exportCSV(
    `expenses_${expFrom || 'all'}_${expTo || 'all'}.csv`,
    ['#', 'Date', 'Category', 'Description', 'Supplier', 'VAT %', 'VAT (€)', 'Gross (€)'],
    rows.map((e, idx) => [idx + 1, e.expense_date, e.category, e.description || '', e.supplier || '', e.vat_rate, e.vat_amount, e.amount_gross])
  );
  $$('[data-edit]').forEach((b) => b.onclick = () => editExpense(b.dataset.edit));
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this expense?')) return;
    await del('/expenses/' + b.dataset.del); toast('Deleted', 'success'); renderExpenses();
  });
}

async function editExpense(id) {
  await loadExpenseCategories();
  const ex = id ? await get('/expenses/' + id) : { vat_rate: 0 };
  const f = (k) => esc(ex[k] ?? '');
  const hasCurrent = ex.category && !expenseCategories.some((c) => c.name === ex.category);
  const catOptions = [
    ...expenseCategories.map((c) => `<option value="${esc(c.name)}" ${ex.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`),
    hasCurrent ? `<option value="${esc(ex.category)}" selected>${esc(ex.category)}</option>` : '',
  ].join('');
  openModal({
    title: id ? t('Edit Expense') : t('New Expense'),
    bodyHTML: `
      <div class="form-row">
        <div class="field"><label>${t('Expense Date')} *</label><input id="x-date" type="date" value="${f('expense_date') || today()}"></div>
        <div class="field"><label>${t('Category')}</label>
          <select id="x-cat">${catOptions}</select>
        </div>
      </div>
      <div class="field"><label>${t('Description')}</label><input id="x-desc" value="${f('description')}"></div>
      <div class="form-row">
        <div class="field"><label>${t('Supplier')}</label><input id="x-supplier" value="${f('supplier')}"></div>
        <div class="field"><label>${t('Document Ref')}</label><input id="x-doc" value="${f('document_ref')}"></div>
      </div>
      <div class="form-row-3">
        <div class="field"><label>${t('Gross (€)')} *</label><input id="x-gross" type="number" step="0.01" value="${f('amount_gross')}"></div>
        <div class="field"><label>${t('VAT %')}</label><input id="x-vat" type="number" step="0.01" value="${f('vat_rate')}"></div>
        <div class="field"><label>${t('Method')}</label>
          <select id="x-method">${PAY_METHODS.map((m) => `<option value="${m}" ${ex.payment_method === m ? 'selected' : ''}>${methodIcon[m]} ${methodLabel(m)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label>${t('Notes')}</label><textarea id="x-notes">${f('notes')}</textarea></div>`,
    footHTML: `<button class="btn" id="x-cancel">${t('Cancel')}</button><button class="btn btn-primary" id="x-save">${t('Save Expense')}</button>`,
  });
  $('#x-cancel').onclick = closeModal;
  $('#x-save').onclick = async () => {
    const amount = $('#x-gross').value;
    if (!amount || Number(amount) <= 0) return toast('A positive amount is required', 'error');
    const payload = {
      expense_date: $('#x-date').value, category: $('#x-cat').value,
      description: $('#x-desc').value, supplier: $('#x-supplier').value,
      amount_gross: amount, vat_rate: $('#x-vat').value,
      payment_method: $('#x-method').value, document_ref: $('#x-doc').value, notes: $('#x-notes').value,
    };
    try {
      await (id ? put('/expenses/' + id, payload) : post('/expenses', payload));
      toast(t('Save'), 'success'); closeModal(); renderExpenses();
    } catch (e) { toast(e.message, 'error'); }
  };
}

async function manageExpenseCategories() {
  await loadExpenseCategories();
  openModal({
    title: t('Categories'),
    bodyHTML: `
      <div style="display:flex;gap:8px">
        <input id="cat-new" placeholder="${t('New category name')}" style="flex:1">
        <button class="btn btn-primary" id="cat-add">${t('Add')}</button>
      </div>
      <table class="grid-table" style="margin-top:14px">
        <thead><tr><th>${t('Category')}</th><th style="width:120px">${t('Actions')}</th></tr></thead>
        <tbody>
          ${expenseCategories.map((c) => `<tr>
            <td><input class="cat-name" data-id="${c.id}" value="${esc(c.name)}" style="width:100%"></td>
            <td class="num" style="white-space:nowrap">
              <button class="btn btn-sm" data-ren="${c.id}">💾</button>
              <button class="btn btn-sm btn-danger" data-delcat="${c.id}">🗑️</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="2" class="muted">${t('No data')}</td></tr>`}
        </tbody>
      </table>`,
    footHTML: `<button class="btn" id="cat-close">${t('Close')}</button>`,
  });
  $('#cat-close').onclick = closeModal;
  $('#cat-add').onclick = async () => {
    const name = $('#cat-new').value.trim();
    if (!name) return toast('Category name is required', 'error');
    try { await post('/expense-categories', { name }); toast('Category added', 'success'); manageExpenseCategories(); }
    catch (e) { toast(e.message, 'error'); }
  };
  $$('[data-ren]').forEach((b) => b.onclick = async () => {
    const name = $('.cat-name', b.closest('tr')).value.trim();
    if (!name) return toast('Category name is required', 'error');
    try { await put('/expense-categories/' + b.dataset.ren, { name }); toast('Renamed', 'success'); manageExpenseCategories(); }
    catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-delcat]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this category?')) return;
    try { await del('/expense-categories/' + b.dataset.delcat); toast('Deleted', 'success'); manageExpenseCategories(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ============================================================
   Invoices
   ============================================================ */
route('invoices', async () => {
  $('#topbar-actions').innerHTML = canWrite() ? `<button class="btn btn-primary" id="add-inv">${t('+ New Invoice')}</button>` : '';
  const add = $('#add-inv'); if (add) add.onclick = () => editInvoice();
  await renderInvoices();
});

// Daily view by default — from/to both = today. User can widen the range to look back.
let invFilter = '';
let invFrom = today();
let invTo = today();

async function renderInvoices() {
  const qs = new URLSearchParams();
  if (invFilter) qs.set('status', invFilter);
  if (invFrom) qs.set('from', invFrom);
  if (invTo) qs.set('to', invTo);
  const rows = await get('/invoices?' + qs.toString());

  const filters = ['', 'draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled', 'void'];
  const sumTotal = rows.reduce((a, r) => a + r.total, 0);
  const sumBalance = rows.reduce((a, r) => a + (r.total - r.amount_paid), 0);

  $('#view').innerHTML = `
    <div class="toolbar">
      <label class="muted">${t('From')}</label><input type="date" id="inv-from" value="${invFrom}" style="max-width:160px">
      <label class="muted">${t('To')}</label><input type="date" id="inv-to" value="${invTo}" style="max-width:160px">
      <button class="btn btn-sm" id="inv-today">${t('Today')}</button>
      <button class="btn btn-sm" id="inv-month">${t('This Month')}</button>
      <button class="btn btn-sm" id="inv-all">${t('All Dates')}</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="inv-export">${t('⬇ Export Excel')}</button>
    </div>
    <div class="toolbar">
      ${filters.map((s) => `<button class="btn btn-sm ${invFilter === s ? 'btn-primary' : ''}" data-filter="${s}">${s ? t(s.charAt(0).toUpperCase() + s.slice(1)) : t('All')}</button>`).join('')}
    </div>
    <div class="table-wrap">
      <table class="grid-table">
        <thead><tr>
          <th class="num" style="width:44px">${t('#')}</th><th>${t('Invoice #')}</th><th>${t('Customer')}</th>
          <th>${t('Issue')}</th><th>${t('Due')}</th><th>${t('Status')}</th><th class="num">${t('Total')}</th><th class="num">${t('Balance')}</th>
          <th style="width:150px">${t('Actions')}</th>
        </tr></thead>
        <tbody>
          ${rows.map((i, idx) => `
            <tr>
              <td class="num muted">${idx + 1}</td>
              <td><a class="link" data-view="${i.id}">${esc(i.invoice_no)}</a></td>
              <td>${esc(i.customer_name)}</td>
              <td>${esc(i.issue_date)}</td>
              <td>${esc(i.due_date || '—')}</td>
              <td>${badge(i.status)}</td>
              <td class="num mono">${money(i.total)}</td>
              <td class="num mono">${money(i.total - i.amount_paid)}</td>
              <td class="num" style="white-space:nowrap">
                ${canWrite() && !i.is_locked ? `<button class="btn btn-sm" data-edit="${i.id}" title="${t('Edit')}">✏️</button>` : ''}
                <button class="btn btn-sm" data-print="${i.id}" title="Print / PDF">🖨️</button>
                ${canWrite() && !i.is_locked ? `<button class="btn btn-sm btn-danger" data-del="${i.id}" title="${t('Delete')}">🗑️</button>` : ''}
                ${i.is_locked ? '<span class="muted" title="Issued & immutable">🔒</span>' : ''}
              </td>
            </tr>`).join('') || `<tr><td colspan="9" class="empty">${t('No data')}</td></tr>`}
        </tbody>
        ${rows.length ? `<tfoot><tr>
          <td colspan="6" class="right"><strong>${t('Total')} (${rows.length})</strong></td>
          <td class="num mono"><strong>${money(sumTotal)}</strong></td>
          <td class="num mono"><strong>${money(sumBalance)}</strong></td>
          <td></td>
        </tr></tfoot>` : ''}
      </table>
    </div>`;

  const reload = () => { invFrom = $('#inv-from').value; invTo = $('#inv-to').value; renderInvoices(); };
  $('#inv-from').onchange = reload;
  $('#inv-to').onchange = reload;
  $('#inv-today').onclick = () => { invFrom = invTo = today(); renderInvoices(); };
  $('#inv-month').onclick = () => { invFrom = today().slice(0, 8) + '01'; invTo = today(); renderInvoices(); };
  $('#inv-all').onclick = () => { invFrom = ''; invTo = ''; renderInvoices(); };
  $('#inv-export').onclick = () => exportCSV(
    `invoices_${invFrom || 'all'}_${invTo || 'all'}.csv`,
    ['#', 'Invoice #', 'Customer', 'Issue', 'Due', 'Status', 'Total', 'Balance'],
    rows.map((i, idx) => [idx + 1, i.invoice_no, i.customer_name, i.issue_date, i.due_date || '', i.status, i.total, (i.total - i.amount_paid).toFixed(2)])
  );

  $$('[data-filter]').forEach((b) => b.onclick = () => { invFilter = b.dataset.filter; renderInvoices(); });
  $$('[data-view]').forEach((b) => b.onclick = () => viewInvoice(b.dataset.view));
  $$('[data-edit]').forEach((b) => b.onclick = () => editInvoice(b.dataset.edit));
  $$('[data-print]').forEach((b) => b.onclick = () => window.open('/api/invoices/' + b.dataset.print + '/pdf', '_blank'));
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this invoice? This cannot be undone.')) return;
    try { await del('/invoices/' + b.dataset.del); toast('Invoice deleted', 'success'); renderInvoices(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

async function editInvoice(id) {
  const [customers, items, inv] = await Promise.all([
    get('/customers'), get('/items'), id ? get('/invoices/' + id) : Promise.resolve(null),
  ]);
  if (inv && inv.is_locked) {
    return toast('This invoice is issued and immutable. Use Cancel to create a correction.', 'error');
  }
  const lines = inv ? inv.items : [];

  openModal({
    title: id ? `${t('Edit')} ${inv.invoice_no}` : t('New Invoice'),
    wide: true,
    bodyHTML: `
      <div class="form-row-3">
        <div class="field"><label>${t('Customer')} *</label>
          <select id="in-customer">
            <option value="">${t('— select —')}</option>
            ${customers.map((c) => `<option value="${c.id}" ${inv && inv.customer_id == c.id ? 'selected' : ''}>${esc(c.name)}${c.company ? ' · ' + esc(c.company) : ''}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>${t('Issue Date')}</label><input id="in-issue" type="date" value="${esc(inv ? inv.issue_date : today())}"></div>
        <div class="field"><label>${t('Due Date')}</label><input id="in-due" type="date" value="${esc(inv ? inv.due_date || '' : '')}"></div>
      </div>
      <div class="form-row-3">
        <div class="field"><label>${t('Client Country')}</label><input id="in-country" value="${esc(inv ? inv.client_country || '' : 'Myanmar')}" placeholder="Myanmar"></div>
        <div class="field"><label>${t('Service Period Start')}</label><input id="in-svc-start" type="date" value="${esc(inv ? inv.service_period_start || '' : '')}"></div>
        <div class="field"><label>${t('Service Period End')}</label><input id="in-svc-end" type="date" value="${esc(inv ? inv.service_period_end || '' : '')}"></div>
      </div>
      <div class="muted" style="font-size:12px;margin:-8px 0 4px">${t('Non-EU clients (e.g. Myanmar) are automatically VAT-exempt (§ 3a Abs. 2 UStG) when this invoice is issued. Service period is required before issuing.')}</div>

      <table class="line-table">
        <thead><tr><th class="col-desc">${t('Item / Description')}</th><th>${t('Qty')}</th><th>${t('Price')}</th><th>${t('Tax %')}</th><th class="num">${t('Amount')}</th><th></th></tr></thead>
        <tbody id="line-rows"></tbody>
      </table>
      <button class="btn btn-sm" id="add-line" style="margin-top:8px">${t('+ Add line')}</button>

      <div class="form-row" style="margin-top:18px">
        <div>
          <div class="field"><label>${t('Notes')}</label><textarea id="in-notes">${esc(inv ? inv.notes || '' : '')}</textarea></div>
          <div class="field"><label>${t('Terms')}</label><textarea id="in-terms">${esc(inv ? inv.terms || '' : '')}</textarea></div>
        </div>
        <div class="totals-box">
          <div class="row"><span>${t('Subtotal')}</span><span class="mono" id="t-sub">—</span></div>
          <div class="row"><span>${t('Discount')}</span><input id="in-discount" type="number" step="0.01" style="max-width:120px;text-align:right" value="${inv ? inv.discount : 0}"></div>
          <div class="row"><span>${t('Tax')}</span><span class="mono" id="t-tax">—</span></div>
          <div class="row grand"><span>${t('Total')}</span><span class="mono" id="t-total">—</span></div>
        </div>
      </div>`,
    footHTML: `<button class="btn" id="in-cancel">${t('Cancel')}</button><button class="btn btn-primary" id="in-save">${t('Save Invoice')}</button>`,
  });

  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const rowsBody = $('#line-rows');

  function addRow(line = {}) {
    const tr = el(`
      <tr>
        <td class="col-desc">
          <select class="l-item"><option value="">${t('— select —')}</option>
            ${items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}
          </select>
          <input class="l-desc" placeholder="${t('Description')}" value="${esc(line.description || '')}" style="margin-top:4px">
        </td>
        <td><input class="l-qty" type="number" step="0.01" style="width:70px" value="${line.quantity ?? 1}"></td>
        <td><input class="l-price" type="number" step="0.01" style="width:90px" value="${line.unit_price ?? 0}"></td>
        <td><input class="l-tax" type="number" step="0.01" style="width:60px" value="${line.tax_rate ?? 0}"></td>
        <td class="num mono l-amount">0.00</td>
        <td><button class="line-remove">&times;</button></td>
      </tr>`);
    if (line.item_id) $('.l-item', tr).value = line.item_id;
    $('.l-item', tr).onchange = (e) => {
      const it = itemsById[e.target.value];
      if (it) { $('.l-desc', tr).value = it.name; $('.l-price', tr).value = it.price; $('.l-tax', tr).value = it.tax_rate; }
      recalc();
    };
    $$('.l-qty,.l-price,.l-tax', tr).forEach((i) => i.oninput = recalc);
    $('.line-remove', tr).onclick = () => { tr.remove(); recalc(); };
    rowsBody.appendChild(tr);
  }

  function recalc() {
    let sub = 0, tax = 0;
    $$('#line-rows tr').forEach((tr) => {
      const q = +$('.l-qty', tr).value || 0, p = +$('.l-price', tr).value || 0, t = +$('.l-tax', tr).value || 0;
      const amt = q * p;
      $('.l-amount', tr).textContent = fmt(amt);
      sub += amt; tax += amt * (t / 100);
    });
    const disc = +$('#in-discount').value || 0;
    $('#t-sub').textContent = money(sub);
    $('#t-tax').textContent = money(tax);
    $('#t-total').textContent = money(Math.max(0, sub - disc + tax));
  }

  if (lines.length) lines.forEach(addRow); else addRow();
  recalc();
  $('#add-line').onclick = () => addRow();
  $('#in-discount').oninput = recalc;
  $('#in-cancel').onclick = closeModal;

  $('#in-save').onclick = async () => {
    const customer_id = $('#in-customer').value;
    if (!customer_id) return toast(t('Please select a customer'), 'error');
    const lineItems = $$('#line-rows tr').map((tr) => ({
      item_id: $('.l-item', tr).value || null,
      description: $('.l-desc', tr).value,
      quantity: $('.l-qty', tr).value,
      unit_price: $('.l-price', tr).value,
      tax_rate: $('.l-tax', tr).value,
    })).filter((l) => l.description.trim());
    if (!lineItems.length) return toast(t('Add at least one line item'), 'error');

    const payload = {
      customer_id, issue_date: $('#in-issue').value, due_date: $('#in-due').value || null,
      discount: $('#in-discount').value, notes: $('#in-notes').value, terms: $('#in-terms').value,
      client_country: $('#in-country').value || 'Myanmar',
      service_period_start: $('#in-svc-start').value || null,
      service_period_end: $('#in-svc-end').value || null,
      items: lineItems,
    };
    try {
      const saved = await (id ? put('/invoices/' + id, payload) : post('/invoices', payload));
      toast('Invoice saved', 'success'); closeModal();
      await navigate('invoices'); viewInvoice(saved.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

async function viewInvoice(id) {
  const inv = await get('/invoices/' + id);
  const c = inv.customer;
  const balance = inv.total - inv.amount_paid;
  const isDraft = !inv.is_locked;
  const isCancelled = inv.status === 'cancelled';
  const isStorno = !!inv.original_invoice_id;
  const statusButtons = canWrite() && isDraft ? ['void'].filter((s) => s !== inv.status)
    .map((s) => `<button class="btn btn-sm" data-status="${s}">${statusLabel(s)}</button>`).join('') : '';

  openModal({
    title: `${t('Invoice')} ${inv.invoice_no}`,
    wide: true,
    bodyHTML: `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div>
          <div class="muted">${t('Bill To')}</div>
          <strong>${esc(c.name)}</strong>
          <div class="muted">${esc(c.company || '')}</div>
          <div class="muted">${esc(c.email || '')}</div>
          <div class="muted">${esc(inv.client_country || '')}</div>
        </div>
        <div class="right">
          <div>${badge(inv.status)} ${isDraft ? '' : '<span title="Issued & immutable">🔒</span>'}</div>
          <div class="muted" style="margin-top:6px">${t('Issue')}: ${esc(inv.issue_date)}</div>
          <div class="muted">${t('Due')}: ${esc(inv.due_date || '—')}</div>
          ${(inv.service_period_start || inv.service_period_end) ? `<div class="muted">${t('Service Period')}: ${esc(inv.service_period_start || '—')} – ${esc(inv.service_period_end || '—')}</div>` : ''}
          ${isStorno && inv.original_invoice_no ? `<div class="muted">Cancels: ${esc(inv.original_invoice_no)}</div>` : ''}
        </div>
      </div>
      <div class="table-wrap" style="box-shadow:none">
        <table>
          <thead><tr><th>${t('Description')}</th><th class="num">${t('Qty')}</th><th class="num">${t('Price')}</th><th class="num">${t('Tax')}</th><th class="num">${t('Amount')}</th></tr></thead>
          <tbody>
            ${inv.items.map((it) => `<tr><td>${esc(it.description)}</td><td class="num">${it.quantity}</td><td class="num mono">${money(it.unit_price)}</td><td class="num">${it.tax_rate}%</td><td class="num mono">${money(it.line_total)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="totals-box" style="margin-top:14px">
        <div class="row"><span>${t('Subtotal')}</span><span class="mono">${money(inv.subtotal)}</span></div>
        ${inv.discount ? `<div class="row"><span>${t('Discount')}</span><span class="mono">- ${money(inv.discount)}</span></div>` : ''}
        <div class="row"><span>${t('Tax')} (${inv.vat_rate ?? 0}%)</span><span class="mono">${money(inv.tax_total)}</span></div>
        <div class="row grand"><span>${t('Total')}</span><span class="mono">${money(inv.total)}</span></div>
        <div class="row"><span>${t('Paid')}</span><span class="mono">${money(inv.amount_paid)}</span></div>
        <div class="row" style="font-weight:700"><span>${t('Balance Due')}</span><span class="mono">${money(balance)}</span></div>
      </div>
      ${inv.vat_exemption_reason ? `<div class="vat-note">${esc(inv.vat_exemption_reason)}</div>` : ''}
      ${isDraft ? `<div class="lock-note">${t('Draft — editable. Issue to lock and assign the official sequential invoice number.')}</div>` : ''}
      ${inv.payments.length ? `
        <h3 class="card-title" style="margin-top:20px">${t('Payments')}</h3>
        <table>
          <thead><tr><th>${t('Date')}</th><th>${t('Method')}</th><th>${t('Reference')}</th><th class="num">${t('Amount')}</th><th></th></tr></thead>
          <tbody>${inv.payments.map((p) => `<tr><td>${esc(p.paid_at)}</td><td>${methodIcon[p.method] || ''} ${esc(methodLabel(p.method))}</td><td>${esc(p.reference || '')}</td><td class="num mono">${money(p.amount)}</td><td class="num">${canWrite() ? `<button class="btn btn-sm btn-danger" data-delpay="${p.id}">×</button>` : ''}</td></tr>`).join('')}</tbody>
        </table>` : ''}
      ${!isDraft && !isStorno ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px">
          <h3 class="card-title" style="margin:0">${t('Settlements')} <span class="muted" style="font-weight:400;font-size:11px">(EUR / Zuflussprinzip)</span></h3>
          ${canWrite() ? `<button class="btn btn-sm" id="add-settlement">${t('+ Add Settlement')}</button>` : ''}
        </div>
        <table>
          <thead><tr><th>${t('Settlement Date')}</th><th>${t('Billed Amount')}</th><th class="num">Settled (EUR)</th><th class="num">Fee (EUR)</th><th>${t('Method')}</th><th>${t('Reference')}</th><th></th></tr></thead>
          <tbody>${(inv.settlements || []).map((s) => `<tr><td>${esc(s.settlement_date)}</td><td>${fmt(s.billed_amount)} ${esc(s.billed_currency)}</td><td class="num mono">€ ${fmt(s.settled_amount_eur)}</td><td class="num mono">€ ${fmt(s.gateway_fee_eur)}</td><td>${esc(s.payment_method || '')}</td><td>${esc(s.transaction_ref || '')}</td><td>${canWrite() ? `<button class="btn btn-sm btn-danger" data-delsettle="${s.id}">×</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="7" class="muted">${t('No data')}</td></tr>`}</tbody>
        </table>` : ''}`,
    footHTML: `
      <button class="btn" onclick="window.open('/api/invoices/${inv.id}/pdf','_blank')">📄 PDF</button>
      ${statusButtons}
      ${canWrite() && isDraft ? `<button class="btn btn-sm" data-edit="${inv.id}">${t('Edit')}</button>` : ''}
      ${canWrite() && isDraft ? `<button class="btn btn-primary" id="issue-inv">🚀 ${t('Issue')}</button>` : ''}
      ${canWrite() && !isDraft && !isCancelled && !isStorno ? `<button class="btn btn-danger" id="cancel-inv">🧾 ${t('Cancel (Storno)')}</button>` : ''}
      ${canWrite() && balance > 0 && isDraft ? `<button class="btn btn-primary" id="record-pay">💵 ${t('Record Payment')}</button>` : ''}
      ${canWrite() && balance > 0 && !isDraft && !isCancelled ? `<button class="btn btn-primary" id="record-pay">💵 ${t('Record Payment')}</button>` : ''}`,
  });

  $$('[data-status]').forEach((b) => b.onclick = async () => {
    await patch('/invoices/' + inv.id + '/status', { status: b.dataset.status });
    toast('Status updated', 'success'); closeModal(); renderInvoices();
  });
  const editBtn = $('[data-edit]'); if (editBtn) editBtn.onclick = () => { closeModal(); editInvoice(inv.id); };
  $$('[data-delpay]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this payment?')) return;
    await del('/payments/' + b.dataset.delpay); toast('Payment removed', 'success'); closeModal(); viewInvoice(inv.id);
  });
  $$('[data-delsettle]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this settlement record?')) return;
    await del('/settlements/' + b.dataset.delsettle); toast('Settlement removed', 'success'); closeModal(); viewInvoice(inv.id);
  });
  const rp = $('#record-pay');
  if (rp) rp.onclick = () => recordPayment(inv);
  const issueBtn = $('#issue-inv');
  if (issueBtn) issueBtn.onclick = async () => {
    if (!confirm('Issue this invoice? It will be locked and assigned an official sequential number. This cannot be undone.')) return;
    try {
      await post('/invoices/' + inv.id + '/issue');
      toast('Invoice issued', 'success'); closeModal(); renderInvoices();
    } catch (e) { toast(e.message, 'error'); }
  };
  const cancelBtn = $('#cancel-inv');
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!confirm('Cancel this invoice? A Stornorechnung (credit note) will be created automatically.')) return;
    try {
      await post('/invoices/' + inv.id + '/cancel');
      toast('Invoice cancelled — Stornorechnung created', 'success'); closeModal(); renderInvoices();
    } catch (e) { toast(e.message, 'error'); }
  };
  const addSettle = $('#add-settlement');
  if (addSettle) addSettle.onclick = () => addSettlement(inv);
}

function addSettlement(inv) {
  openModal({
    title: `${t('Add Settlement')} — ${inv.invoice_no}`,
    bodyHTML: `
      <div class="form-row">
        <div class="field"><label>${t('Settlement Date')}</label><input id="st-date" type="date" value="${today()}"></div>
        <div class="field"><label>${t('Method')}</label><input id="st-method" placeholder="Wise / Bank Transfer / Stripe"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>${t('Billed Amount')}</label><input id="st-billed" type="number" step="0.01" value="${inv.total}"></div>
        <div class="field"><label>${t('Billed Currency')}</label><input id="st-currency" value="${esc(inv.currency)}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Settled Amount (EUR)</label><input id="st-eur" type="number" step="0.01"></div>
        <div class="field"><label>Gateway Fee (EUR)</label><input id="st-fee" type="number" step="0.01" value="0"></div>
      </div>
      <div class="field"><label>${t('Reference')}</label><input id="st-ref"></div>`,
    footHTML: `<button class="btn" id="st-cancel">${t('Cancel')}</button><button class="btn btn-primary" id="st-save">${t('Save')}</button>`,
  });
  $('#st-cancel').onclick = () => { closeModal(); viewInvoice(inv.id); };
  $('#st-save').onclick = async () => {
    try {
      await post('/settlements', {
        invoice_id: inv.id,
        settlement_date: $('#st-date').value,
        billed_amount: $('#st-billed').value,
        billed_currency: $('#st-currency').value,
        settled_amount_eur: $('#st-eur').value,
        gateway_fee_eur: $('#st-fee').value,
        payment_method: $('#st-method').value,
        transaction_ref: $('#st-ref').value,
      });
      toast('Settlement recorded', 'success'); closeModal(); viewInvoice(inv.id);
    } catch (e) { toast(e.message, 'error'); }
  };
}

function recordPayment(inv) {
  const balance = inv.total - inv.amount_paid;
  openModal({
    title: `${t('Payment for')} ${inv.invoice_no}`,
    bodyHTML: `
      <div class="form-row">
        <div class="field"><label>${t('Amount')}</label><input id="p-amount" type="number" step="0.01" value="${balance.toFixed(2)}"></div>
        <div class="field"><label>${t('Date')}</label><input id="p-date" type="date" value="${today()}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>${t('Method')}</label>
          <select id="p-method">${PAY_METHODS.map((m) => `<option value="${m}">${methodIcon[m]} ${methodLabel(m)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>${t('Reference')}</label><input id="p-ref"></div>
      </div>
      <div class="field"><label>${t('Notes')}</label><textarea id="p-notes"></textarea></div>`,
    footHTML: `<button class="btn" id="p-cancel">${t('Cancel')}</button><button class="btn btn-primary" id="p-save">${t('Save Payment')}</button>`,
  });
  $('#p-cancel').onclick = () => { closeModal(); viewInvoice(inv.id); };
  $('#p-save').onclick = async () => {
    try {
      await post('/payments', {
        invoice_id: inv.id, amount: $('#p-amount').value, method: $('#p-method').value,
        reference: $('#p-ref').value, paid_at: $('#p-date').value, notes: $('#p-notes').value,
      });
      toast('Payment recorded', 'success'); closeModal(); viewInvoice(inv.id);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============================================================
   Payments (global list)
   ============================================================ */
const PAY_METHODS = ['paypal', 'debitcard', 'bank'];
const methodIcon = { paypal: '🅿️', debitcard: '💳', bank: '🏦' };
const METHOD_LABELS = { paypal: 'PayPal', debitcard: 'Debit Card', bank: 'Bank' };
const methodLabel = (m) => (LANG === 'my' ? (MM[m] || METHOD_LABELS[m] || m) : (METHOD_LABELS[m] || m));
let payMethod = '';
let paySearch = '';

route('payments', async () => {
  const all = await get('/payments');
  const s = paySearch.toLowerCase();
  const rows = all.filter((p) =>
    (!payMethod || p.method === payMethod) &&
    (!s || `${p.invoice_no} ${p.customer_name} ${p.reference || ''}`.toLowerCase().includes(s)));
  const sum = rows.reduce((a, p) => a + p.amount, 0);

  $('#view').innerHTML = `
    <div class="toolbar">
      <input class="search" id="pay-search" placeholder="${t('Search…')}" value="${esc(paySearch)}">
      <select id="pay-method" style="max-width:180px">
        <option value="">${t('All methods')}</option>
        ${PAY_METHODS.map((m) => `<option value="${m}" ${payMethod === m ? 'selected' : ''}>${methodIcon[m]} ${methodLabel(m)}</option>`).join('')}
      </select>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="pay-export">${t('⬇ Export Excel')}</button>
    </div>
    <div class="table-wrap">
      <table class="grid-table">
        <thead><tr><th class="num" style="width:44px">${t('#')}</th><th>${t('Date')}</th><th>${t('Invoice')}</th><th>${t('Customer')}</th><th>${t('Method')}</th><th>${t('Reference')}</th><th class="num">${t('Amount')}</th></tr></thead>
        <tbody>
          ${rows.map((p, idx) => `
            <tr>
              <td class="num muted">${idx + 1}</td>
              <td>${esc(p.paid_at)}</td>
              <td><a class="link" data-inv="${p.invoice_id}">${esc(p.invoice_no)}</a></td>
              <td>${esc(p.customer_name)}</td>
              <td>${methodIcon[p.method] || ''} ${esc(methodLabel(p.method))}</td>
              <td>${esc(p.reference || '')}</td>
              <td class="num mono">${money(p.amount)}</td>
            </tr>`).join('') || `<tr><td colspan="7" class="empty">${t('No payments yet')}</td></tr>`}
        </tbody>
        ${rows.length ? `<tfoot><tr><td colspan="6" class="right"><strong>${t('Total')} (${rows.length})</strong></td><td class="num mono"><strong>${money(sum)}</strong></td></tr></tfoot>` : ''}
      </table>
    </div>`;

  let timer;
  $('#pay-search').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { paySearch = e.target.value; navigate('payments'); }, 300); };
  $('#pay-method').onchange = (e) => { payMethod = e.target.value; navigate('payments'); };
  $('#pay-export').onclick = () => exportCSV('payments.csv',
    ['#', 'Date', 'Invoice', 'Customer', 'Method', 'Reference', 'Amount'],
    rows.map((p, idx) => [idx + 1, p.paid_at, p.invoice_no, p.customer_name, p.method, p.reference || '', p.amount]));
  $$('[data-inv]').forEach((a) => a.onclick = () => viewInvoice(a.dataset.inv));
});

/* ============================================================
   Reports
   ============================================================ */
let repFrom = '';
let repTo = '';
route('reports', async () => {
  const qs = new URLSearchParams();
  if (repFrom) qs.set('from', repFrom);
  if (repTo) qs.set('to', repTo);
  const q = qs.toString() ? '?' + qs.toString() : '';
  const [aging, byItem, monthly, euer] = await Promise.all([
    get('/reports/aging' + q), get('/reports/by-item'), get('/reports/monthly' + q), get('/reports/euer-summary' + q),
  ]);
  const b = aging.buckets;
  const mt = monthly.totals;

  $('#view').innerHTML = `
    <div class="toolbar">
      <label class="muted">${t('From')}</label><input type="date" id="rep-from" value="${repFrom}" style="max-width:160px">
      <label class="muted">${t('To')}</label><input type="date" id="rep-to" value="${repTo}" style="max-width:160px">
      <button class="btn btn-sm" id="rep-month">${t('This Month')}</button>
      <button class="btn btn-sm" id="rep-year">${t('This Year')}</button>
      <button class="btn btn-sm" id="rep-all">${t('All')}</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="rep-tax-export">📑 ${t('EÜR Export')}</button>
    </div>

    <div class="grid-3">
      <div class="card"><h3 class="card-title">${t('Income (EUR)')}</h3><div class="stat big">€ ${fmt(euer.income)}</div></div>
      <div class="card"><h3 class="card-title">${t('Expenses (EUR)')}</h3><div class="stat big">€ ${fmt(euer.expenses)}</div><div class="muted" style="font-size:12px">${t('Gateway Fees')}: € ${fmt(euer.gatewayFees)}</div></div>
      <div class="card"><h3 class="card-title">${t('Net Profit')}</h3><div class="stat big ${euer.profit >= 0 ? 'green' : 'red'}">€ ${fmt(euer.profit)}</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3 class="card-title">${t('Receivables Aging')}</h3>
        <table><tbody>
          <tr><td>${t('Current')}</td><td class="num mono">${money(b.current)}</td></tr>
          <tr><td>1–30 ${t('Days')}</td><td class="num mono">${money(b.d1_30)}</td></tr>
          <tr><td>31–60 ${t('Days')}</td><td class="num mono">${money(b.d31_60)}</td></tr>
          <tr><td>61–90 ${t('Days')}</td><td class="num mono">${money(b.d61_90)}</td></tr>
          <tr><td>90+ ${t('Days')}</td><td class="num mono">${money(b.d90_plus)}</td></tr>
        </tbody></table>
      </div>
      <div class="card">
        <h3 class="card-title">${t('Top Selling Items')}</h3>
        <table>
          <thead><tr><th>${t('Item')}</th><th class="num">${t('Qty')}</th><th class="num">${t('Revenue')}</th></tr></thead>
          <tbody>${byItem.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmt(r.qty)}</td><td class="num mono">${money(r.revenue)}</td></tr>`).join('') || `<tr><td class="muted">${t('No data')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 class="card-title" style="margin:0">${t('Monthly Summary (လစဉ်ချုပ်)')}</h3>
        <button class="btn btn-sm" id="rep-export-month">${t('⬇ Export Excel')}</button>
      </div>
      <table class="grid-table" style="margin-top:12px">
        <thead><tr><th class="num" style="width:44px">${t('#')}</th><th>${t('Month')}</th><th class="num">${t('Invoices')}</th><th class="num">${t('Billed')}</th><th class="num">${t('Collected')}</th><th class="num">${t('Outstanding')}</th></tr></thead>
        <tbody>
          ${monthly.rows.map((r, idx) => `<tr>
            <td class="num muted">${idx + 1}</td>
            <td>${esc(r.month)}</td>
            <td class="num">${r.invoices}</td>
            <td class="num mono">${money(r.billed)}</td>
            <td class="num mono">${money(r.collected)}</td>
            <td class="num mono">${money(r.outstanding)}</td>
          </tr>`).join('') || `<tr><td colspan="6" class="empty">${t('No data')}</td></tr>`}
        </tbody>
        ${monthly.rows.length ? `<tfoot><tr>
          <td colspan="2" class="right"><strong>${t('Total')}</strong></td>
          <td class="num"><strong>${mt.invoices}</strong></td>
          <td class="num mono"><strong>${money(mt.billed)}</strong></td>
          <td class="num mono"><strong>${money(mt.collected)}</strong></td>
          <td class="num mono"><strong>${money(mt.outstanding)}</strong></td>
        </tr></tfoot>` : ''}
      </table>
    </div>

    <div class="card" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 class="card-title" style="margin:0">${t('Overdue / Outstanding Invoices')}</h3>
        <button class="btn btn-sm" id="rep-export-aging">${t('⬇ Export Excel')}</button>
      </div>
      <table class="grid-table" style="margin-top:12px">
        <thead><tr><th class="num" style="width:44px">${t('#')}</th><th>${t('Invoice')}</th><th>${t('Customer')}</th><th>${t('Issue')}</th><th>${t('Due')}</th><th class="num">${t('Days')}</th><th class="num">${t('Balance')}</th></tr></thead>
        <tbody>
          ${aging.rows.map((r, idx) => `<tr>
            <td class="num muted">${idx + 1}</td>
            <td><a class="link" data-inv="${r.id}">${esc(r.invoice_no)}</a></td>
            <td>${esc(r.customer_name)}</td>
            <td>${esc(r.issue_date || '—')}</td>
            <td>${esc(r.due_date || '—')}</td>
            <td class="num">${r.days_overdue > 0 ? r.days_overdue : 0}</td>
            <td class="num mono">${money(r.balance)}</td>
          </tr>`).join('') || `<tr><td colspan="7" class="empty">🎉</td></tr>`}
        </tbody>
      </table>
    </div>`;

  const reload = () => { repFrom = $('#rep-from').value; repTo = $('#rep-to').value; navigate('reports'); };
  $('#rep-from').onchange = reload;
  $('#rep-to').onchange = reload;
  $('#rep-month').onclick = () => { repFrom = today().slice(0, 8) + '01'; repTo = today(); navigate('reports'); };
  $('#rep-year').onclick = () => { repFrom = today().slice(0, 4) + '-01-01'; repTo = today(); navigate('reports'); };
  $('#rep-all').onclick = () => { repFrom = ''; repTo = ''; navigate('reports'); };
  $('#rep-tax-export').onclick = () => {
    const eq = new URLSearchParams();
    if (repFrom) eq.set('from', repFrom);
    if (repTo) eq.set('to', repTo);
    window.open('/api/reports/euer-export' + (eq.toString() ? '?' + eq.toString() : ''), '_blank');
  };
  $('#rep-export-month').onclick = () => exportCSV(
    `monthly_summary_${repFrom || 'all'}_${repTo || 'all'}.csv`,
    ['#', 'Month', 'Invoices', 'Billed', 'Collected', 'Outstanding'],
    monthly.rows.map((r, idx) => [idx + 1, r.month, r.invoices, r.billed, r.collected, r.outstanding])
  );
  $('#rep-export-aging').onclick = () => exportCSV(
    `outstanding_${repFrom || 'all'}_${repTo || 'all'}.csv`,
    ['#', 'Invoice', 'Customer', 'Issue', 'Due', 'Days Overdue', 'Balance'],
    aging.rows.map((r, idx) => [idx + 1, r.invoice_no, r.customer_name, r.issue_date || '', r.due_date || '', r.days_overdue > 0 ? r.days_overdue : 0, r.balance])
  );
  $$('[data-inv]').forEach((a) => a.onclick = () => viewInvoice(a.dataset.inv));
});

/* ============================================================
   Settings
   ============================================================ */
route('settings', async () => {
  const s = await get('/settings');
  const f = (k) => esc(s[k] ?? '');
  let logoData = s.logo_url || '';   // holds the current/new logo data URI

  $('#view').innerHTML = `
    <div class="card" style="max-width:720px">
      <h3 class="card-title">${t('Company Logo')}</h3>
      <div style="display:flex;align-items:center;gap:20px;margin-bottom:6px">
        <div id="logo-preview" style="width:130px;height:70px;border:1px dashed var(--border);border-radius:8px;display:grid;place-items:center;background:#fafafa;overflow:hidden">
          ${logoData ? `<img src="${logoData}" style="max-width:100%;max-height:100%">` : '<span class="muted" style="font-size:12px">No logo</span>'}
        </div>
        <div>
          <input type="file" id="logo-file" accept="image/png,image/jpeg,image/svg+xml" style="max-width:280px">
          <div class="muted" style="font-size:12px;margin-top:6px">PNG / JPG / SVG · shown in the sidebar &amp; on invoices (max ~1MB)</div>
          <button class="btn btn-sm btn-danger" id="logo-remove" style="margin-top:8px">Remove logo</button>
        </div>
      </div>
    </div>

    <div class="card" style="max-width:720px;margin-top:18px">
      <h3 class="card-title">Account</h3>
      <div class="field"><label>Email</label><input id="acct-email" type="email" value="${esc(ME.email)}"></div>
      <button class="btn btn-primary" id="acct-email-save">Save Email</button>
      <div style="margin:18px 0;border-top:1px solid var(--border)"></div>
      <div class="form-row">
        <div class="field"><label>Current Password</label><input id="acct-cur" type="password" autocomplete="current-password"></div>
        <div class="field"><label>New Password</label><input id="acct-new" type="password" autocomplete="new-password"></div>
      </div>
      <button class="btn btn-primary" id="acct-pass-save">Change Password</button>
    </div>

    <div class="card" style="max-width:720px;margin-top:18px">
      <h3 class="card-title">${t('Company Details')}</h3>
      <div class="form-row">
        <div class="field"><label>Company Name</label><input id="s-name" value="${f('company_name')}"></div>
        <div class="field"><label>Tax Number</label><input id="s-tax" value="${f('tax_number')}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Email</label><input id="s-email" value="${f('email')}"></div>
        <div class="field"><label>Phone</label><input id="s-phone" value="${f('phone')}"></div>
      </div>
      <div class="field"><label>Address</label><input id="s-address" value="${f('address')}"></div>
      <div class="form-row">
        <div class="field"><label>City</label><input id="s-city" value="${f('city')}"></div>
        <div class="field"><label>Country</label><input id="s-country" value="${f('country')}"></div>
      </div>
      <h3 class="card-title" style="margin-top:20px">${t('Billing Preferences')}</h3>
      <div class="form-row-3">
        <div class="field"><label>Currency Code</label><input id="s-cur" value="${f('currency')}"></div>
        <div class="field"><label>Currency Symbol</label><input id="s-sym" value="${f('currency_symbol')}"></div>
        <div class="field"><label>Default Tax %</label><input id="s-dtax" type="number" step="0.01" value="${f('default_tax')}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Invoice Prefix</label><input id="s-prefix" value="${f('invoice_prefix')}"></div>
        <div class="field"><label>Numbering</label><div class="muted" style="font-size:12px;padding-top:8px">Automatic: <code>INV-YYYY-XXXX</code> (per-year sequence, no gaps)</div></div>
      </div>

      <h3 class="card-title" style="margin-top:20px">German Tax Compliance (Finanzamt)</h3>
      <div class="field">
        <label><input type="checkbox" id="s-klein" ${s.is_kleinunternehmer ? 'checked' : ''}> Kleinunternehmer (§ 19 UStG) — no VAT charged on any invoice</label>
      </div>
      <div class="muted" style="font-size:12px;margin:-4px 0 10px">Non-EU clients (e.g. Myanmar) are always VAT-exempt (§ 3a Abs. 2 UStG) regardless of this setting.</div>
      <div class="form-row">
        <div class="field"><label>Bank Name</label><input id="s-bank-name" value="${f('bank_name')}"></div>
        <div class="field"><label>Account Holder</label><input id="s-bank-holder" value="${f('bank_account_holder')}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>IBAN</label><input id="s-bank-iban" value="${f('bank_iban')}"></div>
        <div class="field"><label>BIC / SWIFT</label><input id="s-bank-bic" value="${f('bank_bic')}"></div>
      </div>

      <h3 class="card-title" style="margin-top:20px">${t('Language')} &amp; Theme</h3>
      <div class="form-row">
        <div class="field"><label>${t('Language')} / ဘာသာစကား</label>
          <select id="s-lang">
            <option value="en" ${s.language === 'en' ? 'selected' : ''}>🇬🇧 English</option>
            <option value="my" ${s.language === 'my' ? 'selected' : ''}>🇲🇲 မြန်မာ</option>
          </select>
        </div>
        <div class="field"><label>Theme</label>
          <select id="s-theme">
            <option value="light" ${THEME === 'light' ? 'selected' : ''}>☀️ Light</option>
            <option value="dark" ${THEME === 'dark' ? 'selected' : ''}>🌙 Dark</option>
          </select>
        </div>
      </div>

      <button class="btn btn-primary" id="s-save" style="margin-top:8px">${t('Save Settings')}</button>
    </div>`;

  $('#s-lang').onchange = (e) => { setLang(e.target.value); navigate('settings'); };
  $('#s-theme').onchange = (e) => { THEME = e.target.value; localStorage.setItem('theme', THEME); applyTheme(); };

  const setPreview = () => {
    $('#logo-preview').innerHTML = logoData
      ? `<img src="${logoData}" style="max-width:100%;max-height:100%">`
      : '<span class="muted" style="font-size:12px">No logo</span>';
  };
  $('#logo-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) return toast('Logo too large (max ~1MB)', 'error');
    const reader = new FileReader();
    reader.onload = () => { logoData = reader.result; setPreview(); toast('Logo loaded — click Save Settings', 'success'); };
    reader.readAsDataURL(file);
  };
  $('#logo-remove').onclick = () => { logoData = ''; $('#logo-file').value = ''; setPreview(); };

  $('#acct-email-save').onclick = async () => {
    const email = $('#acct-email').value.trim();
    if (!email) return toast('Email is required', 'error');
    try {
      await put('/auth/email', { email });
      ME.email = email;
      applyChrome();
      toast('Email updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#acct-pass-save').onclick = async () => {
    const cur = $('#acct-cur').value, next = $('#acct-new').value;
    if (!cur || !next) return toast('Please fill in both password fields', 'error');
    try {
      await put('/auth/password', { current_password: cur, new_password: next });
      $('#acct-cur').value = ''; $('#acct-new').value = '';
      toast('Password updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  $('#s-save').onclick = async () => {
    const payload = {
      company_name: $('#s-name').value, tax_number: $('#s-tax').value, email: $('#s-email').value,
      phone: $('#s-phone').value, address: $('#s-address').value, city: $('#s-city').value,
      country: $('#s-country').value, currency: $('#s-cur').value, currency_symbol: $('#s-sym').value,
      default_tax: $('#s-dtax').value, invoice_prefix: $('#s-prefix').value,
      language: $('#s-lang').value, logo_url: logoData,
      is_kleinunternehmer: $('#s-klein').checked,
      bank_name: $('#s-bank-name').value, bank_account_holder: $('#s-bank-holder').value,
      bank_iban: $('#s-bank-iban').value, bank_bic: $('#s-bank-bic').value,
    };
    try { SETTINGS = await put('/settings', payload); applyBranding(); toast('Settings saved', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
});

async function logout() {
  try { await post('/auth/logout'); } catch (_) {}
  location.reload();
}

/** Populate the sidebar user panel. */
function applyChrome() {
  const initials = (ME.name || ME.email || '?').trim().charAt(0).toUpperCase();
  $('#user-panel').innerHTML = `
    <div class="avatar">${esc(initials)}</div>
    <div style="min-width:0">
      <div class="u-name" style="overflow:hidden;text-overflow:ellipsis">${esc(ME.name || ME.email)}</div>
      <div class="u-role">${esc(ME.org ? ME.org.name : '')}</div>
    </div>
    <button class="logout" id="btn-logout" title="${t('Log out')}">⎋</button>`;
  $('#btn-logout').onclick = logout;
}

(async function boot() {
  // Init theme + clock + top bar controls first (needed on auth screen too)
  applyTheme();
  startClock();
  $('#theme-toggle').onclick = toggleTheme;
  $('#menu-toggle').onclick = () => $('#app').classList.toggle('nav-open');
  $('#sidebar-backdrop').onclick = () => $('#app').classList.remove('nav-open');

  // Authenticated?
  try {
    ME = await get('/auth/me');
  } catch (_) {
    return renderAuth();
  }

  try { SETTINGS = await get('/settings'); } catch (_) {}
  if (SETTINGS.language) LANG = SETTINGS.language;
  applyBranding();
  applyStaticI18n();
  applyChrome();

  const start = (location.hash || '#dashboard').slice(1);
  navigate(routes[start] ? start : 'dashboard');
})();

/* ============================================================
   Auth screen (login, English only)
   ============================================================ */
function renderAuth() {
  $('#app').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo"><span class="brand-mark">₿</span></div>
        <h2>Welcome back</h2>
        <div class="sub">Sign in to continue to Billing</div>
        <form id="auth-form">
          <div class="field"><label>Email</label><input id="a-email" type="email" placeholder="you@example.com" autocomplete="username" required></div>
          <div class="field"><label>Password</label><input id="a-pass" type="password" placeholder="Enter your password" autocomplete="current-password" required></div>
          <button class="btn btn-primary" type="submit">Sign in</button>
        </form>
      </div>
    </div>`;
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await post('/auth/login', { email: $('#a-email').value, password: $('#a-pass').value });
      location.reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  // Show the uploaded company logo on the login screen (falls back to ₿).
  get('/branding').then((b) => {
    const box = $('.auth-logo');
    if (!box || !b) return;
    if (b.logo_url) box.innerHTML = `<img src="${b.logo_url}" alt="logo" class="auth-logo-img">`;
  }).catch(() => {});
}
