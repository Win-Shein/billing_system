"use strict";
// Load .env if present (Node >=20.6 has this built in — no extra dependency needed).
try {
  process.loadEnvFile();
} catch {
  // No .env file found — fine, rely on real environment variables.
}
const path = require("path");
const express = require("express");
const session = require("express-session");

// Initialise DB (creates file + schema on first run)
const db = require("./db/database");
const SqliteStore = require("./lib/sessionStore");
const { requireAuth } = require("./lib/auth");
const { router: authRouter } = require("./routes/auth");
const { rateLimit } = require("./lib/rateLimit");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// In production a strong, secret value is mandatory.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (isProd ? null : "billing-dev-secret-change-me");
if (!SESSION_SECRET) {
  console.error("FATAL: SESSION_SECRET must be set when NODE_ENV=production.");
  process.exit(1);
}

// Behind a reverse proxy (nginx / Caddy / a PaaS) set TRUST_PROXY=1 so the
// real client IP and https are detected. Leave unset when exposed directly.
if (process.env.TRUST_PROXY)
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);

app.disable("x-powered-by");

// Baseline security headers.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (isProd)
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=15552000; includeSubDomains",
    );
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use(
  session({
    store: new SqliteStore(),
    name: "billing.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

// --- Public routes ---
app.get("/api/health", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() }),
);

// Public branding (used by the login screen, no sensitive data).
app.get("/api/branding", (req, res) => {
  const s = db
    .prepare("SELECT company_name, logo_url FROM settings LIMIT 1")
    .get();
  res.json({
    company_name: (s && s.company_name) || "",
    logo_url: (s && s.logo_url) || "",
  });
});

// Throttle credential endpoints against brute-force attacks.
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use("/api/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use("/api/auth/email", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use("/api/auth/password", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use("/api/auth", authRouter);

// --- Everything below requires an authenticated session ---
app.use("/api", requireAuth);
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/items", require("./routes/items"));
app.use("/api/invoices", require("./routes/invoices"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/settlements", require("./routes/settlements"));
app.use("/api/expenses", require("./routes/expenses"));
app.use("/api/expense-categories", require("./routes/expenseCategories"));
app.use("/api/audit", require("./routes/audit"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/settings", require("./routes/settings"));

// --- Static frontend (revalidate so edits show up on refresh) ---
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  }),
);

// SPA fallback
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(500)
    .json({
      error: isProd
        ? "Internal server error"
        : err.message || "Internal server error",
    });
});

app.listen(PORT, () => {
  console.log(`\n  Billing system running →  http://localhost:${PORT}\n`);
});
