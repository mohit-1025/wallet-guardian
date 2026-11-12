import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);
const serveDist = process.argv.includes("--serve-dist") || process.env.NODE_ENV === "production";

const USD_INR_RATE = Number(process.env.USD_INR_RATE) > 0 ? Number(process.env.USD_INR_RATE) : 83.2;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const APP_BASE_URL = (process.env.APP_BASE_URL || (serveDist ? PUBLIC_BASE_URL : "http://localhost:5173")).replace(/\/$/, "");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = "wg_session";

// Sandbox only. Demo and real accounts share the same PayPal sandbox app, so
// nothing in this server can reach PayPal's live API or move real money.
const SANDBOX = {
  base: "https://api-m.sandbox.paypal.com",
  web: "https://www.sandbox.paypal.com",
  clientId: process.env.PAYPAL_SANDBOX_CLIENT_ID || "",
  clientSecret: process.env.PAYPAL_SANDBOX_CLIENT_SECRET || "",
  payoutsEnabled: String(process.env.PAYPAL_SANDBOX_PAYOUTS_ENABLED ?? "auto").toLowerCase() !== "false",
  invoicerEmail: process.env.PAYPAL_SANDBOX_INVOICER_EMAIL || "",
};

function sandboxConfigured() {
  return Boolean(SANDBOX.clientId && SANDBOX.clientSecret);
}

// ---- Accounts ----
// Email/password accounts live in a SQLite database beside the server's other
// private state. Passwords are scrypt-hashed and never stored or logged in
// plain text.
const DATA_DIR = process.env.WG_DATA_DIR || path.join(os.homedir(), ".wallet-guardian");
fs.mkdirSync(DATA_DIR, { recursive: true });
const accountsDb = new DatabaseSync(path.join(DATA_DIR, "accounts.db"));
accountsDb.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);

// Each account attaches its OWN PayPal sandbox app credentials during
// onboarding, encrypted at rest. They are write-once: no endpoint replaces or
// removes them, so one account can never spend another's sandbox balance.
accountsDb.exec(`CREATE TABLE IF NOT EXISTS user_sandbox_credentials (
  user_id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);

// Internal transfers: paying a receiver whose email is itself a Wallet
// Guardian account queues a credit here. The receiver's client picks it up,
// registers the incoming transaction and bumps the balance.
accountsDb.exec(`CREATE TABLE IF NOT EXISTS incoming_transfers (
  id TEXT PRIMARY KEY,
  to_user_id TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  amount_inr REAL NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
)`);
accountsDb.exec(`DROP TABLE IF EXISTS paypal_intents`);

const scrypt = promisify(crypto.scrypt);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

async function scryptKey(password, salt, keylen, { N = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P } = {}) {
  return Buffer.from(await scrypt(String(password), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptKey(password, salt, SCRYPT_KEYLEN);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

const FALLBACK_SALT = Buffer.alloc(16, 7);

// Runs a full scrypt comparison even for unknown emails so response time does
// not reveal whether an account exists.
async function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltB64, hashB64] = String(stored || "").split("$");
  const usable =
    scheme === "scrypt" && Number(N) > 0 && Number(r) > 0 && Number(p) > 0 && Boolean(saltB64) && Boolean(hashB64);
  const expected = usable ? Buffer.from(hashB64, "base64url") : Buffer.alloc(SCRYPT_KEYLEN);
  const actual = await scryptKey(
    password,
    usable ? Buffer.from(saltB64, "base64url") : FALLBACK_SALT,
    expected.length || SCRYPT_KEYLEN,
    { N: Number(N) || SCRYPT_N, r: Number(r) || SCRYPT_R, p: Number(p) || SCRYPT_P },
  );
  return usable && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at || row.createdAt };
}

function paypalCapabilities(ctx) {
  return {
    identity: false,
    payerPayments: true,
    personalBalance: false,
    personalTransactions: false,
    businessPayouts: Boolean(ctx?.configured && ctx.cfg.payoutsEnabled),
    businessInvoices: Boolean(ctx?.configured),
  };
}

const sessions = new Map();

function hmac(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        return idx === -1 ? [part, ""] : [part.slice(0, idx), part.slice(idx + 1)];
      }),
  );
}

function readSession(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw) return null;
  const [sid, exp, sig] = raw.split(".");
  if (!sid || !exp || !sig || !safeEqual(sig, hmac(`${sid}.${exp}`))) return null;
  if (Number(exp) < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  const session = sessions.get(sid);
  if (!session) return null;
  return { sid, ...session };
}

function sessionCookie(req, value, maxAgeSeconds) {
  const secure =
    req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https") || PUBLIC_BASE_URL.startsWith("https://")
      ? "; Secure"
      : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function issueSession(req, res, user) {
  const sid = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(sid, { user, env: "sandbox", createdAt: Date.now(), expiresAt });
  res.setHeader("Set-Cookie", sessionCookie(req, `${sid}.${expiresAt}.${hmac(`${sid}.${expiresAt}`)}`, Math.floor(SESSION_TTL_MS / 1000)));
}

function destroySession(req, res) {
  const session = readSession(req);
  if (session) sessions.delete(session.sid);
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
}

app.disable("x-powered-by");
// Behind a hosting proxy (e.g. Vercel -> Render) set TRUST_PROXY to the number
// of hops so rate limits key on the real client instead of the proxy.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY || 0);
if (Number.isFinite(TRUST_PROXY_HOPS) && TRUST_PROXY_HOPS > 0) {
  app.set("trust proxy", TRUST_PROXY_HOPS);
}
app.use(cors({ origin: [APP_BASE_URL, PUBLIC_BASE_URL], credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/") || req.path.startsWith("/paypal")) {
    res.setHeader("Cache-Control", "no-store");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && origin !== APP_BASE_URL && origin !== PUBLIC_BASE_URL) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }
  }
  next();
});

const rateBuckets = new Map();
app.use("/api", (req, res, next) => {
  const ip = req.ip || "local";
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + 60_000;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > 90) return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  next();
});

// Separate, slower budget for credential endpoints to blunt password guessing.
const authAttempts = new Map();
app.use("/api/auth", (req, res, next) => {
  if (req.method !== "POST" || (req.path !== "/login" && req.path !== "/register")) return next();
  const ip = req.ip || "local";
  const now = Date.now();
  const bucket = authAttempts.get(ip) || { count: 0, reset: now + 10 * 60_000 };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + 10 * 60_000;
  }
  bucket.count += 1;
  authAttempts.set(ip, bucket);
  if (bucket.count > 20) {
    return res.status(429).json({ error: "Too many sign-in attempts. Please wait a few minutes." });
  }
  next();
});

function simId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function parseInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 8_000_000) return null;
  return Math.round(n * 100) / 100;
}

function usdFromInr(amountInr) {
  return Math.round((amountInr / USD_INR_RATE) * 100) / 100;
}

function validEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function requireText(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isoDate(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : fallback;
}

// Access tokens are cached per credential owner ("shared" for the demo, the
// user id for signed-in accounts) so one user's token never serves another.
const tokenCaches = new Map();

// ---- Sandbox credential store ----
// Credentials entered during onboarding are verified against PayPal's sandbox,
// encrypted with AES-256-GCM and kept in settings.db beside the accounts. The
// key never leaves the server: WG_SETTINGS_KEY, or settings.key generated on
// first run. Environment credentials still win when both are present.
function settingsKey() {
  const raw = String(process.env.WG_SETTINGS_KEY || "").trim();
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length === 32) return key;
    console.warn("[settings] WG_SETTINGS_KEY is not 32 bytes — using a generated local key.");
  }
  const file = path.join(DATA_DIR, "settings.key");
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file);
    if (key.length === 32) return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

const SETTINGS_KEY = settingsKey();
const settingsDb = new DatabaseSync(path.join(DATA_DIR, "settings.db"));
settingsDb.exec("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
// Older builds created app_settings with a NOT NULL updated_at column, so the
// upsert has to match whatever schema the on-disk database already has.
const settingsHasUpdatedAt = settingsDb
  .prepare("PRAGMA table_info(app_settings)")
  .all()
  .some((column) => column.name === "updated_at");
const upsertSetting = settingsHasUpdatedAt
  ? settingsDb.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
  : settingsDb.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
function saveSetting(key, value) {
  if (settingsHasUpdatedAt) upsertSetting.run(key, value, new Date().toISOString());
  else upsertSetting.run(key, value);
}

function encryptSetting(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", SETTINGS_KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

function decryptSetting(raw) {
  const [iv, tag, data] = String(raw).split(".");
  if (!iv || !tag || !data) throw new Error("stored value is malformed");
  const decipher = crypto.createDecipheriv("aes-256-gcm", SETTINGS_KEY, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"));
}

const sandboxSource = { value: sandboxConfigured() ? "env" : "none" };

function applySandboxCredentials({ clientId, clientSecret, invoicerEmail = "", payoutsEnabled = true }) {
  SANDBOX.clientId = String(clientId || "").trim();
  SANDBOX.clientSecret = String(clientSecret || "").trim();
  SANDBOX.invoicerEmail = String(invoicerEmail || "").trim();
  SANDBOX.payoutsEnabled = payoutsEnabled !== false;
  tokenCaches.delete("shared");
}

// Per-user sandbox credentials, attached once during onboarding.
function getUserSandbox(userId) {
  const row = accountsDb.prepare("SELECT value FROM user_sandbox_credentials WHERE user_id = ?").get(userId);
  if (!row) return null;
  try {
    const saved = decryptSetting(row.value);
    if (saved?.clientId && saved?.clientSecret) {
      return {
        clientId: String(saved.clientId),
        clientSecret: String(saved.clientSecret),
        invoicerEmail: String(saved.invoicerEmail || ""),
        payoutsEnabled: saved.payoutsEnabled !== false,
      };
    }
  } catch (err) {
    console.error("[settings] could not read a user's sandbox credentials:", err.message);
  }
  return null;
}

function loadStoredSandboxCredentials() {
  if (sandboxConfigured()) return;
  const row = settingsDb.prepare("SELECT value FROM app_settings WHERE key = ?").get("paypal_sandbox");
  if (!row) return;
  try {
    const saved = decryptSetting(row.value);
    if (saved?.clientId && saved?.clientSecret) {
      applySandboxCredentials(saved);
      sandboxSource.value = "stored";
    }
  } catch (err) {
    console.error("[settings] could not read stored sandbox credentials:", err.message);
  }
}
loadStoredSandboxCredentials();

async function verifySandboxCredentials(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${SANDBOX.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && Boolean(data.access_token), message: data?.error_description || data?.error || null };
}

async function paypalToken(ctx) {
  if (!ctx.configured) throw new Error("PayPal sandbox credentials are not configured for this account");
  const cache = tokenCaches.get(ctx.cacheKey) || { token: null, expiresAt: 0 };
  if (cache.token && Date.now() < cache.expiresAt - 30_000) return cache.token;
  const auth = Buffer.from(`${ctx.cfg.clientId}:${ctx.cfg.clientSecret}`).toString("base64");
  const res = await fetch(`${SANDBOX.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error_description || "PayPal authentication failed");
  cache.token = data.access_token;
  cache.expiresAt = Date.now() + (data.expires_in ?? 3000) * 1000;
  tokenCaches.set(ctx.cacheKey, cache);
  return cache.token;
}

async function paypal(ctx, pathname, { method = "GET", body, requestId } = {}) {
  const token = await paypalToken(ctx);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${SANDBOX.base}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const message = data?.message || data?.error_description || `PayPal request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// The demo workspace is unauthenticated and carries an x-wg-account: demo
// header. Everything, demo or signed in, resolves to the sandbox.
function isDemoRequest(req) {
  return req.get("x-wg-account") === "demo" && !readSession(req);
}

// The demo workspace rides on the server's shared sandbox app; every signed-in
// account uses only the credentials it attached during onboarding.
function paypalContext(req) {
  const demo = isDemoRequest(req);
  const session = readSession(req);
  if (demo || !session) {
    return { demo, session, env: "sandbox", cfg: SANDBOX, configured: sandboxConfigured(), cacheKey: "shared" };
  }
  const creds = getUserSandbox(session.user.id);
  return {
    demo: false,
    session,
    env: "sandbox",
    cfg: creds || { clientId: "", clientSecret: "", invoicerEmail: "", payoutsEnabled: false },
    configured: Boolean(creds),
    cacheKey: session.user.id,
  };
}

function simulated(extra) {
  return {
    env: "sandbox",
    simulated: true,
    message: "PayPal sandbox simulation — no real money moves.",
    ...extra,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    paypalMode: sandboxConfigured() ? "sandbox" : "simulated",
    sandboxConfigured: sandboxConfigured(),
    loginMode: "email",
    time: new Date().toISOString(),
  });
});

// ---- Authentication: email and password ----

app.post("/api/auth/register", async (req, res) => {
  const name = requireText(req.body?.name, 80);
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (name.length < 2) return res.status(400).json({ error: "Enter your name." });
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Use a password with at least 8 characters." });
  if (password.length > 128) return res.status(400).json({ error: "Keep your password under 128 characters." });
  if (accountsDb.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: "An account with that email already exists. Sign in instead." });
  }

  let user;
  try {
    const passwordHash = await hashPassword(password);
    user = { id: `user_${crypto.randomUUID()}`, email, name, createdAt: new Date().toISOString() };
    accountsDb
      .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.email, user.name, passwordHash, user.createdAt);
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err?.message || ""))) {
      return res.status(409).json({ error: "An account with that email already exists. Sign in instead." });
    }
    console.error("[auth] register failed:", err.message);
    return res.status(500).json({ error: "Could not create the account. Please try again." });
  }

  issueSession(req, res, user);
  res.status(201).json({ authenticated: true, user, env: "sandbox" });
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!validEmail(email) || !password) {
    return res.status(400).json({ error: "Enter your email and password." });
  }
  try {
    const row = accountsDb.prepare("SELECT * FROM users WHERE email = ?").get(email);
    const ok = await verifyPassword(password, row?.password_hash);
    if (!row || !ok) return res.status(401).json({ error: "Email or password is incorrect." });
    const user = publicUser(row);
    issueSession(req, res, user);
    res.json({ authenticated: true, user, env: "sandbox" });
  } catch (err) {
    console.error("[auth] login failed:", err.message);
    res.status(500).json({ error: "Could not sign in. Please try again." });
  }
});

app.get("/api/auth/me", (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({
    authenticated: true,
    user: session.user,
    env: "sandbox",
    capabilities: paypalCapabilities(paypalContext(req)),
    expiresAt: session.expiresAt,
  });
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

// Signed-in money flows. The demo workspace is the only unauthenticated caller
// and is pinned to the sandbox just like every account.
app.use("/api/paypal", (req, res, next) => {
  if (req.path === "/status") return next();
  if (isDemoRequest(req)) return next();
  if (!readSession(req)) {
    return res.status(401).json({ error: "Sign in to use PayPal payments." });
  }
  next();
});

app.get("/api/paypal/status", (req, res) => {
  const ctx = paypalContext(req);
  res.json({
    configured: ctx.configured,
    mode: ctx.configured ? "sandbox" : "simulated",
    env: "sandbox",
    source: ctx.demo || !ctx.session ? sandboxSource.value : ctx.configured ? "user" : "none",
    authenticated: Boolean(ctx.session),
    payoutsEnabled: ctx.configured && ctx.cfg.payoutsEnabled,
    usdRate: USD_INR_RATE,
    loginMode: "email",
    capabilities: paypalCapabilities(ctx),
  });
});

// Onboarding attaches the account's OWN sandbox app credentials. Verified
// against PayPal, encrypted at rest, and write-once: no endpoint replaces or
// removes them, so an account always spends from its own sandbox balance.
app.post("/api/paypal/sandbox/connect", async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Sign in to connect the PayPal sandbox." });
  if (getUserSandbox(session.user.id)) {
    return res.status(409).json({ error: "This account already has sandbox credentials attached. They cannot be changed." });
  }
  const clientId = requireText(req.body?.clientId, 200);
  const clientSecret = requireText(req.body?.clientSecret, 400);
  if (clientId.length < 10 || clientSecret.length < 10) {
    return res.status(400).json({ error: "Enter the sandbox Client ID and Secret from developer.paypal.com." });
  }
  try {
    const check = await verifySandboxCredentials(clientId, clientSecret);
    if (!check.ok) {
      return res.status(400).json({
        error: check.message
          ? `PayPal rejected these sandbox credentials: ${check.message}`
          : "PayPal rejected these sandbox credentials. Check the Client ID and Secret.",
      });
    }
  } catch {
    return res.status(502).json({ error: "Could not reach the PayPal sandbox to verify the credentials. Try again." });
  }
  accountsDb
    .prepare("INSERT INTO user_sandbox_credentials (user_id, value, created_at) VALUES (?, ?, ?)")
    .run(session.user.id, encryptSetting({ clientId, clientSecret, invoicerEmail: "", payoutsEnabled: true }), new Date().toISOString());
  console.log(`[paypal] personal sandbox credentials attached for ${session.user.email}`);
  const ctx = paypalContext(req);
  res.json({ connected: true, mode: "sandbox", source: "user", payoutsEnabled: true, capabilities: paypalCapabilities(ctx) });
});

app.post("/api/paypal/sandbox/disconnect", (req, res) => {
  res.status(409).json({ error: "Sandbox credentials are attached to this account for good and cannot be removed or replaced." });
});

// ---- Internal transfers between Wallet Guardian accounts ----
// Paying a receiver whose email belongs to another account queues a credit
// here. The receiver's client polls, registers the incoming transaction, bumps
// the balance and marks the transfer consumed.
app.get('/api/paypal/transfers', (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Sign in to read incoming transfers.' });
  const rows = accountsDb
    .prepare('SELECT id, from_email, from_name, amount_inr, note, created_at FROM incoming_transfers WHERE to_user_id = ? AND consumed = 0 ORDER BY created_at')
    .all(session.user.id);
  res.json({
    transfers: rows.map((r) => ({
      id: r.id,
      fromEmail: r.from_email,
      fromName: r.from_name,
      amountInr: r.amount_inr,
      note: r.note,
      createdAt: r.created_at,
    })),
  });
});

app.post('/api/paypal/transfers/consume', (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Sign in to consume incoming transfers.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => requireText(v, 80)).filter(Boolean).slice(0, 100) : [];
  const stmt = accountsDb.prepare('UPDATE incoming_transfers SET consumed = 1 WHERE to_user_id = ? AND id = ?');
  let consumed = 0;
  for (const id of ids) consumed += Number(stmt.run(session.user.id, id).changes);
  res.json({ consumed });
});

// ---- PayPal money flows (sandbox) ----

app.post("/api/paypal/order", async (req, res) => {
  const ctx = paypalContext(req);
  const amountInr = parseInr(req.body?.amountInr);
  const intent = req.body?.intent === "AUTHORIZE" ? "AUTHORIZE" : "CAPTURE";
  const description = requireText(req.body?.description, 127) || "Wallet Guardian payment";
  if (!amountInr) return res.status(400).json({ error: "Enter an amount between ₹0.01 and ₹80,00,000." });
  const amountUsd = usdFromInr(amountInr);
  if (amountUsd < 0.01) return res.status(400).json({ error: "That amount is too small to charge through PayPal." });

  if (!ctx.configured) {
    return res.json(simulated({ id: simId("SIM-ORDER"), status: "CREATED", amountUsd }));
  }

  try {
    const order = await paypal(ctx, "/v2/checkout/orders", {
      method: "POST",
      body: {
        intent,
        purchase_units: [{ amount: { currency_code: "USD", value: amountUsd.toFixed(2) }, description }],
        application_context: {
          brand_name: "Wallet Guardian",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      },
      requestId: `wg-${crypto.randomUUID()}`,
    });
    const approvalUrl = order.links?.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;
    res.json({ id: order.id, status: order.status, env: "sandbox", simulated: false, approvalUrl, amountUsd });
  } catch (err) {
    console.error("[paypal] order error", err.message);
    res.json(
      simulated({
        id: simId("SIM-ORDER"),
        status: "CREATED",
        amountUsd,
        message: `PayPal sandbox unavailable (${err.message}). Simulated and labelled — no real money moves.`,
      }),
    );
  }
});

app.post("/api/paypal/order/:id/capture", async (req, res) => {
  const ctx = paypalContext(req);
  const orderId = requireText(req.params.id, 80);
  if (!ctx.configured || orderId.startsWith("SIM-")) {
    return res.json(
      simulated({ id: orderId, status: "COMPLETED", captureId: simId("SIM-CAPTURE"), message: "PayPal sandbox simulation — no real money moved." }),
    );
  }
  try {
    const data = await paypal(ctx, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      body: {},
      requestId: `wg-cap-${crypto.randomUUID()}`,
    });
    const captureId = data.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    res.json({ id: data.id, status: data.status, env: "sandbox", simulated: false, captureId });
  } catch (err) {
    // A real order that could not be captured (e.g. ORDER_NOT_APPROVED) must
    // surface as a failure — silently simulating a capture would credit an
    // in-app balance for money that never moved in the sandbox.
    res.json({ id: orderId, status: "FAILED", env: "sandbox", simulated: false, captureId: undefined, error: err.message });
  }
});

app.post("/api/paypal/order/:id/authorize", async (req, res) => {
  const ctx = paypalContext(req);
  const orderId = requireText(req.params.id, 80);
  if (!ctx.configured || orderId.startsWith("SIM-")) {
    return res.json(
      simulated({
        id: orderId,
        status: "COMPLETED",
        authorizationId: simId("SIM-AUTH"),
        message: "PayPal sandbox simulation — no funds are held.",
      }),
    );
  }
  try {
    const data = await paypal(ctx, `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
      method: "POST",
      body: {},
      requestId: `wg-auth-${crypto.randomUUID()}`,
    });
    const authorizationId = data.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    res.json({ id: data.id, status: data.status, env: "sandbox", simulated: false, authorizationId });
  } catch (err) {
    res.json(
      simulated({
        id: orderId,
        status: "COMPLETED",
        authorizationId: simId("SIM-AUTH"),
        message: `PayPal sandbox authorization failed (${err.message}). Simulated and labelled.`,
      }),
    );
  }
});

app.post("/api/paypal/authorization/:id/capture", async (req, res) => {
  const ctx = paypalContext(req);
  const authId = requireText(req.params.id, 80);
  if (!ctx.configured || authId.startsWith("SIM-")) {
    return res.json(simulated({ id: simId("SIM-CAPTURE"), status: "COMPLETED" }));
  }
  try {
    const data = await paypal(ctx, `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, {
      method: "POST",
      body: { final_capture: true },
      requestId: `wg-auth-cap-${crypto.randomUUID()}`,
    });
    res.json({ id: data.id, status: data.status, env: "sandbox", simulated: false, captureId: data.id });
  } catch (err) {
    res.json(
      simulated({
        id: simId("SIM-CAPTURE"),
        status: "COMPLETED",
        message: `PayPal sandbox capture failed (${err.message}). Simulated and labelled.`,
      }),
    );
  }
});

app.post("/api/paypal/authorization/:id/void", async (req, res) => {
  const ctx = paypalContext(req);
  const authId = requireText(req.params.id, 80);
  if (!ctx.configured || authId.startsWith("SIM-")) {
    return res.json(simulated({ id: authId, status: "VOIDED" }));
  }
  try {
    await paypal(ctx, `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, {
      method: "POST",
      requestId: `wg-void-${crypto.randomUUID()}`,
    });
    res.json({ id: authId, status: "VOIDED", env: "sandbox", simulated: false });
  } catch (err) {
    res.json(
      simulated({
        id: authId,
        status: "VOIDED",
        message: `PayPal sandbox release failed (${err.message}). Simulated and labelled.`,
      }),
    );
  }
});

app.post("/api/paypal/invoice", async (req, res) => {
  const ctx = paypalContext(req);
  const email = requireText(req.body?.email, 120);
  const name = requireText(req.body?.name, 80) || "Wallet Guardian customer";
  const amountInr = parseInr(req.body?.amountInr);
  const description = requireText(req.body?.description, 100) || "Payment request";
  const dueDate = isoDate(req.body?.dueDate, new Date().toISOString().slice(0, 10));
  if (!validEmail(email)) return res.status(400).json({ error: "A valid recipient email is required." });
  if (!amountInr) return res.status(400).json({ error: "Enter a valid invoice amount." });
  const amountUsd = usdFromInr(amountInr);

  if (!ctx.configured) {
    return res.json(
      simulated({ invoiceId: simId("SIM-INV"), status: "DRAFT", message: "PayPal sandbox simulation — no invoice was created." }),
    );
  }

  try {
    const invoice = await paypal(ctx, "/v2/invoicing/invoices", {
      method: "POST",
      body: {
        detail: {
          invoice_number: simId("WG"),
          currency_code: "USD",
          note: description,
          payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: dueDate },
        },
        invoicer: ctx.cfg.invoicerEmail ? { email_address: ctx.cfg.invoicerEmail } : undefined,
        primary_recipients: [{ billing_info: { email_address: email, name: { given_name: name } } }],
        items: [
          {
            name: description,
            quantity: "1",
            unit_amount: { currency_code: "USD", value: amountUsd.toFixed(2) },
          },
        ],
      },
      requestId: `wg-inv-${crypto.randomUUID()}`,
    });
    const href = invoice.href || invoice.invoice_href || "";
    const invoiceId = href.split("/").pop() || simId("INV");
    let status = "DRAFT";
    let message;
    try {
      await paypal(ctx, `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
        method: "POST",
        body: { send_to_recipient: true, send_to_invoicer: false },
        requestId: `wg-inv-send-${crypto.randomUUID()}`,
      });
      status = "SENT";
    } catch (sendErr) {
      message = `Draft created, but PayPal could not send it yet: ${sendErr.message}. Share the invoice link instead.`;
      console.warn("[paypal] invoice send:", sendErr.message);
    }
    res.json({
      invoiceId,
      status,
      env: "sandbox",
      simulated: false,
      invoiceUrl: `${SANDBOX.web}/invoice/p/#${invoiceId}`,
      message,
    });
  } catch (err) {
    res.json(
      simulated({
        invoiceId: simId("SIM-INV"),
        status: "DRAFT",
        message: `PayPal sandbox invoice failed (${err.message}). Simulated and labelled.`,
      }),
    );
  }
});

app.post("/api/paypal/payout", async (req, res) => {
  const ctx = paypalContext(req);
  const email = requireText(req.body?.email, 120);
  const name = requireText(req.body?.name, 100) || "Payee";
  const amountInr = parseInr(req.body?.amountInr);
  const note = requireText(req.body?.note, 140) || "Wallet Guardian autopay";
  if (!validEmail(email)) return res.status(400).json({ error: "A valid payee email is required." });
  if (!amountInr) return res.status(400).json({ error: "Enter a valid payout amount." });
  const amountUsd = usdFromInr(amountInr);

  // A receiver who is themselves a Wallet Guardian account gets credited here
  // in-app, whatever PayPal's sandbox answers. Queued before the PayPal call so
  // the in-app leg never depends on the sandbox leg.
  let internalTransfer = null;
  if (ctx.session) {
    const receiver = accountsDb.prepare("SELECT id, email, name FROM users WHERE email = ?").get(normalizeEmail(email));
    if (receiver && receiver.id !== ctx.session.user.id) {
      accountsDb
        .prepare("INSERT INTO incoming_transfers (id, to_user_id, from_email, from_name, amount_inr, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          `tr_${crypto.randomUUID()}`,
          receiver.id,
          ctx.session.user.email,
          ctx.session.user.name,
          amountInr,
          note,
          new Date().toISOString(),
        );
      internalTransfer = { toName: receiver.name };
    }
  }

  const simulatedPayout = (reason) => ({
    batchId: simId("SIM-PAYOUT"),
    status: "SIMULATED",
    env: "sandbox",
    simulated: true,
    internalTransfer,
    message: `${reason} No real money moved.`,
  });

  if (!ctx.configured) return res.json(simulatedPayout("PayPal sandbox credentials are not configured."));
  if (!ctx.cfg.payoutsEnabled) {
    return res.json(simulatedPayout("PayPal Payouts are disabled on the sandbox account."));
  }

  try {
    const data = await paypal(ctx, "/v1/payments/payouts", {
      method: "POST",
      body: {
        sender_batch_header: {
          sender_batch_id: simId("WG-BATCH"),
          email_subject: "You received a payment from Wallet Guardian",
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { currency: "USD", value: amountUsd.toFixed(2) },
            receiver: email,
            note,
            sender_item_id: simId("ITEM"),
            recipient_wallet: "PAYPAL",
          },
        ],
      },
      requestId: `wg-payout-${crypto.randomUUID()}`,
    });
    res.json({
      batchId: data.batch_header?.payout_batch_id || simId("BATCH"),
      status: data.batch_header?.batch_status || "PENDING",
      env: "sandbox",
      simulated: false,
      internalTransfer,
    });
  } catch (err) {
    console.error("[paypal] payout failed:", err.message);
    res.json(simulatedPayout(`PayPal sandbox payout failed (${err.message}).`));
  }
});

if (serveDist) {
  const dist = path.resolve(__dirname, "../dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get("*", (_req, res) => res.sendFile(path.resolve(dist, "index.html")));
    console.log(`Serving built app from ${dist}`);
  } else {
    console.warn("dist/ not found — run npm run build first.");
  }
}

app.use((err, _req, res, _next) => {
  console.error("[api] unhandled", err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`Wallet Guardian API on http://localhost:${PORT}`);
  console.log("Accounts: email + password sign-in enabled. All PayPal activity runs on the sandbox.");
  console.log(
    sandboxConfigured()
      ? "PayPal sandbox credentials detected. Orders, invoices and payouts call the sandbox API."
      : "No sandbox credentials. Payments use clearly-labelled simulations only.",
  );
});
