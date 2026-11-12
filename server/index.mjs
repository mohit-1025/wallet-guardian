import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
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

// Real accounts sign in with PayPal and only ever act on live money. The demo
// workspace is the single exception: its requests carry an x-wg-account: demo
// header and run against the sandbox (or a clearly-labelled simulation when no
// sandbox credentials exist). A real session can never reach the demo path.
const ENVIRONMENTS = {
  live: {
    base: "https://api-m.paypal.com",
    web: "https://www.paypal.com",
    clientId: process.env.PAYPAL_LIVE_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_LIVE_CLIENT_SECRET || "",
    payoutsEnabled: String(process.env.PAYPAL_LIVE_PAYOUTS_ENABLED ?? "auto").toLowerCase() !== "false",
    invoicerEmail: process.env.PAYPAL_INVOICER_EMAIL || "",
  },
  sandbox: {
    base: "https://api-m.sandbox.paypal.com",
    web: "https://www.sandbox.paypal.com",
    clientId: process.env.PAYPAL_SANDBOX_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_SANDBOX_CLIENT_SECRET || "",
    payoutsEnabled: String(process.env.PAYPAL_SANDBOX_PAYOUTS_ENABLED ?? "auto").toLowerCase() !== "false",
    invoicerEmail: process.env.PAYPAL_SANDBOX_INVOICER_EMAIL || "",
  },
};

// ---- Server settings store ----
// The first-run setup page saves the app's live PayPal credentials here. Values
// are encrypted with AES-256-GCM using a 32-byte key file and never leave the
// server. The database and key live outside the project so they are never
// committed or synced with the source tree.
const DATA_DIR = process.env.WG_DATA_DIR || path.join(os.homedir(), ".wallet-guardian");
fs.mkdirSync(DATA_DIR, { recursive: true });
const settingsDb = new DatabaseSync(path.join(DATA_DIR, "settings.db"));
settingsDb.exec(
  "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
);
const SETTINGS_KEY = (() => {
  const provided = String(process.env.WG_SETTINGS_KEY || "").trim();
  if (provided) {
    const buffer = Buffer.from(provided, /^[0-9a-f]{64}$/i.test(provided) ? "hex" : "base64");
    if (buffer.length === 32) return buffer;
  }
  const keyPath = path.join(DATA_DIR, "settings.key");
  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === 32) return existing;
  } catch {
    // First run: create the key below.
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
})();

function encryptSetting(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", SETTINGS_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSetting(raw) {
  const [version, iv, tag, data] = String(raw || "").split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", SETTINGS_KEY, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function readSetting(key) {
  const row = settingsDb.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row ? decryptSetting(row.value) : null;
}

function writeSetting(key, value) {
  settingsDb
    .prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(key, encryptSetting(value), new Date().toISOString());
}

let credentialSource = null;

function loadStoredCredentials() {
  if (envConfigured("live")) {
    credentialSource = "env";
    return;
  }
  const clientId = readSetting("paypal_live_client_id");
  const clientSecret = readSetting("paypal_live_client_secret");
  if (clientId && clientSecret) {
    ENVIRONMENTS.live.clientId = clientId;
    ENVIRONMENTS.live.clientSecret = clientSecret;
    credentialSource = "database";
  }
}

function maskClientId(clientId) {
  if (!clientId) return null;
  return clientId.length <= 12 ? `${clientId.slice(0, 4)}…` : `${clientId.slice(0, 6)}…${clientId.slice(-4)}`;
}

function isLocalRequest(req) {
  const address = req.socket?.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function setupAllowed(req) {
  return isLocalRequest(req);
}

async function verifyLiveAppCredentials(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${ENVIRONMENTS.live.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      body.error_description ||
        "PayPal rejected those credentials. Use the Client ID and Secret from a Live REST app, not a sandbox app.",
    );
  }
}

function envConfigured(env = "live") {
  const cfg = ENVIRONMENTS[env];
  return Boolean(cfg?.clientId && cfg?.clientSecret);
}

function resolveLoginEnv() {
  return envConfigured("live") ? "live" : null;
}

loadStoredCredentials();

function loginConfigured() {
  return Boolean(resolveLoginEnv());
}

// Payouts, invoicing and reporting use the app's client credentials, so they act
// on the PayPal business account that owns the app — never on a signed-in payer's
// personal account. That account's email is allowlisted so other PayPal users
// who sign in can pay from their own account but cannot move the owner's money.
const BUSINESS_EMAILS = String(process.env.PAYPAL_BUSINESS_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function businessAllowed(user) {
  return Boolean(user?.email) && BUSINESS_EMAILS.includes(String(user.email).toLowerCase());
}

function paypalCapabilities(env, user, demo = false) {
  if (demo) {
    const configured = envConfigured("sandbox");
    return {
      identity: true,
      payerPayments: true,
      personalBalance: false,
      personalTransactions: false,
      businessPayouts: configured && ENVIRONMENTS.sandbox.payoutsEnabled,
      businessInvoices: configured,
      businessReporting: false,
    };
  }
  const business = envConfigured(env) && businessAllowed(user);
  return {
    identity: true,
    payerPayments: true,
    personalBalance: false,
    personalTransactions: false,
    businessPayouts: business && ENVIRONMENTS[env].payoutsEnabled,
    businessInvoices: business,
    businessReporting: business,
  };
}

function normalizePayPalUser(info) {
  const email = info.email || info.emails?.find((entry) => entry.primary)?.value || info.emails?.[0]?.value || "";
  const payerId = info.payer_id || info.user_id || "";
  const name =
    info.name || [info.given_name, info.family_name].filter(Boolean).join(" ") || email.split("@")[0] || "PayPal member";
  const accountStatus = requireText(info.account_verification_status, 40);
  return { payerId, email, name, verified: accountStatus.toLowerCase() === "verified", accountStatus };
}

async function fetchPayPalUserInfo(env, accessToken) {
  const res = await fetch(`${ENVIRONMENTS[env].base}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const info = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(info.message || "Could not read your PayPal profile.");
  const user = normalizePayPalUser(info);
  if (!user.payerId || !user.email) throw new Error("PayPal did not return a usable identity.");
  return user;
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

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

function verifyState(raw) {
  const [body, sig] = String(raw || "").split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.env || !ENVIRONMENTS[payload.env]) return null;
    if (Date.now() - Number(payload.t) > 10 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
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

function issueSession(req, res, { env, user, accessToken, tokenExpiresAt }) {
  const sid = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(sid, { env, user, accessToken, tokenExpiresAt, createdAt: Date.now(), expiresAt });
  res.setHeader("Set-Cookie", sessionCookie(req, `${sid}.${expiresAt}.${hmac(`${sid}.${expiresAt}`)}`, Math.floor(SESSION_TTL_MS / 1000)));
}

function destroySession(req, res) {
  const session = readSession(req);
  if (session) sessions.delete(session.sid);
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
}

function serverErrorPage(title, detail) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0c0e17;color:#e7e9f3;display:flex;min-height:100vh;align-items:center;justify-content:center">
<main style="max-width:520px;padding:32px;text-align:center">
<h1 style="font-size:22px;margin:0 0 10px">${title}</h1>
<p style="font-size:14px;line-height:1.6;color:#9aa0b8;margin:0 0 22px">${detail}</p>
<a href="${APP_BASE_URL}/login" style="display:inline-block;background:#4f46e5;color:white;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">Back to sign in</a>
<p style="font-size:12px;color:#6f7590;margin-top:18px">Or use the demo workspace on the login page — it never moves money.</p>
</main></body></html>`;
}

app.disable("x-powered-by");
app.use(cors({ origin: [APP_BASE_URL, PUBLIC_BASE_URL], credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/") || req.path.startsWith("/paypal") || req.path.startsWith("/setup")) {
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

const tokenCaches = {
  live: { token: null, expiresAt: 0 },
  sandbox: { token: null, expiresAt: 0 },
};

async function paypalToken(env) {
  if (!envConfigured(env)) throw new Error(`PayPal ${env} credentials are not configured`);
  const cache = tokenCaches[env];
  if (cache.token && Date.now() < cache.expiresAt - 30_000) return cache.token;
  const cfg = ENVIRONMENTS[env];
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(`${cfg.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error_description || "PayPal authentication failed");
  cache.token = data.access_token;
  cache.expiresAt = Date.now() + (data.expires_in ?? 3000) * 1000;
  return cache.token;
}

async function paypal(env, pathname, { method = "GET", body, requestId } = {}) {
  const token = await paypalToken(env);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${ENVIRONMENTS[env].base}${pathname}`, {
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

// The demo workspace is unauthenticated but can only ever reach the sandbox.
// A signed-in real account always resolves to live and never gets a simulation.
function isDemoRequest(req) {
  return req.get("x-wg-account") === "demo" && !readSession(req);
}

function paypalContext(req) {
  if (isDemoRequest(req)) {
    return {
      demo: true,
      session: null,
      env: "sandbox",
      cfg: ENVIRONMENTS.sandbox,
      configured: envConfigured("sandbox"),
    };
  }
  return {
    demo: false,
    session: readSession(req),
    env: "live",
    cfg: ENVIRONMENTS.live,
    configured: envConfigured("live"),
  };
}

function liveUnavailable(res, ctx) {
  return res.status(503).json({
    error: `PayPal live is not connected on this server. Open ${APP_BASE_URL}/setup to add your PayPal app credentials, or use the demo workspace.`,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    paypalMode: resolveLoginEnv() ?? "unconfigured",
    loginConfigured: loginConfigured(),
    liveConfigured: envConfigured("live"),
    sandboxConfigured: envConfigured("sandbox"),
    time: new Date().toISOString(),
  });
});

// ---- First-run PayPal app setup ----
// These endpoints configure the app's own PayPal REST credentials. They never
// accept a PayPal account password and only store the client secret encrypted
// on the server; the browser never reads it back.
app.get("/api/setup/paypal", (req, res) => {
  const configured = loginConfigured();
  res.json({
    configured,
    source: credentialSource,
    env: "live",
    clientIdHint: configured ? maskClientId(ENVIRONMENTS.live.clientId) : null,
    redirectUri: `${PUBLIC_BASE_URL}/api/auth/paypal/callback`,
    canEdit: !configured && setupAllowed(req),
  });
});

app.post("/api/setup/paypal", async (req, res) => {
  if (loginConfigured()) {
    return res.status(409).json({
      error: "PayPal is already connected. Remove the stored credentials on the server before connecting a different app.",
    });
  }
  if (!setupAllowed(req)) {
    return res.status(403).json({
      error: "For safety, PayPal setup is only allowed from the machine running the server.",
    });
  }
  const clientId = requireText(req.body?.clientId, 200);
  const clientSecret = requireText(req.body?.clientSecret, 200);
  if (clientId.length < 20 || clientSecret.length < 20) {
    return res.status(400).json({ error: "Enter the Live Client ID and Secret from your PayPal REST app." });
  }
  try {
    await verifyLiveAppCredentials(clientId, clientSecret);
  } catch (err) {
    return res.status(400).json({ error: err.message || "PayPal rejected those credentials." });
  }
  writeSetting("paypal_live_client_id", clientId);
  writeSetting("paypal_live_client_secret", clientSecret);
  ENVIRONMENTS.live.clientId = clientId;
  ENVIRONMENTS.live.clientSecret = clientSecret;
  credentialSource = "database";
  tokenCaches.live.token = null;
  tokenCaches.live.expiresAt = 0;
  console.log("[setup] PayPal live app connected. Real accounts can now sign in.");
  res.json({ ok: true, configured: true, source: credentialSource });
});

// ---- Authentication: Log in with PayPal ----

app.get("/api/auth/paypal/start", (req, res) => {
  const env = resolveLoginEnv();
  if (!env) {
    return res
      .status(503)
      .type("html")
      .send(
        serverErrorPage(
          "PayPal live sign-in is not connected",
          `Open the setup page at <code>${APP_BASE_URL}/setup</code> and add the Client ID and Secret from your live PayPal REST app. Register <code>${PUBLIC_BASE_URL}/api/auth/paypal/callback</code> as its redirect URI. Wallet Guardian is live-only: every account signs in with PayPal and moves real money, and each payment still needs approval on PayPal.`,
        ),
      );
  }
  const cfg = ENVIRONMENTS[env];
  const state = signState({ n: crypto.randomBytes(16).toString("base64url"), env, t: Date.now() });
  // Identity only: PayPal has no Log in with PayPal scope for a payer's balance
  // or personal transaction history, so the app never claims to read those.
  const params = new URLSearchParams({
    flowEntry: "static",
    client_id: cfg.clientId,
    response_type: "code",
    scope: "openid profile email https://uri.paypal.com/services/paypalattributes",
    redirect_uri: `${PUBLIC_BASE_URL}/api/auth/paypal/callback`,
    state,
  });
  res.redirect(`${cfg.web}/connect?${params.toString()}`);
});

app.get("/api/auth/paypal/callback", async (req, res) => {
  const state = verifyState(req.query.state);
  if (!state) {
    return res.redirect(`${APP_BASE_URL}/login?error=${encodeURIComponent("Sign-in expired or invalid. Please try again.")}`);
  }
  if (req.query.error) {
    const detail = requireText(req.query.error_description, 160) || "PayPal sign-in was cancelled.";
    return res.redirect(`${APP_BASE_URL}/login?error=${encodeURIComponent(detail)}`);
  }
  const code = requireText(req.query.code, 4000);
  if (!code) {
    return res.redirect(`${APP_BASE_URL}/login?error=${encodeURIComponent("PayPal did not return a sign-in code.")}`);
  }
  if (!envConfigured(state.env)) {
    return res.redirect(
      `${APP_BASE_URL}/login?error=${encodeURIComponent(`PayPal ${state.env} credentials are missing on the server.`)}`,
    );
  }

  try {
    const cfg = ENVIRONMENTS[state.env];
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    const tokenRes = await fetch(`${cfg.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${PUBLIC_BASE_URL}/api/auth/paypal/callback`,
      }).toString(),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) {
      throw new Error(token.error_description || "Could not exchange the PayPal login code.");
    }

    const info = await fetchPayPalUserInfo(state.env, token.access_token);
    issueSession(req, res, {
      env: state.env,
      user: info,
      accessToken: token.access_token,
      tokenExpiresAt: Date.now() + Number(token.expires_in || 0) * 1000,
    });
    res.redirect(`${APP_BASE_URL}/app`);
  } catch (err) {
    console.error("[auth] PayPal callback failed:", err.message);
    res.redirect(`${APP_BASE_URL}/login?error=${encodeURIComponent(err.message.slice(0, 180))}`);
  }
});

app.get("/api/auth/me", (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({
    authenticated: true,
    user: session.user,
    env: session.env,
    mode: envConfigured(session.env) ? "live" : "unconfigured",
    capabilities: paypalCapabilities(session.env, session.user),
    expiresAt: session.expiresAt,
  });
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

// Real money flows require a signed-in PayPal session and fail closed when it
// expires. The demo workspace is the only unauthenticated caller and is pinned
// to the sandbox, so it can never touch live money.
app.use("/api/paypal", (req, res, next) => {
  if (req.path === "/status") return next();
  if (isDemoRequest(req)) return next();
  if (!readSession(req)) {
    return res.status(401).json({ error: "Sign in with PayPal again to use real payments." });
  }
  next();
});

app.get("/api/paypal/account", async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Sign in with PayPal to read your account." });

  let user = session.user;
  let fresh = false;
  if (session.accessToken && Number(session.tokenExpiresAt) > Date.now() + 5000) {
    try {
      user = await fetchPayPalUserInfo(session.env, session.accessToken);
      fresh = true;
    } catch (err) {
      console.warn("[auth] PayPal profile refresh failed:", err.message);
    }
  }

  res.json({
    linked: true,
    user,
    env: session.env,
    capabilities: paypalCapabilities(session.env, user),
    fresh,
    note: "PayPal provides your name, email, payer ID and verification status. PayPal does not expose a personal account balance or transaction history to apps using Log in with PayPal, so Wallet Guardian keeps that ledger locally.",
  });
});

app.get("/api/paypal/status", (req, res) => {
  const ctx = paypalContext(req);
  const payoutReady = ctx.demo
    ? ctx.configured && ctx.cfg.payoutsEnabled
    : ctx.configured && businessAllowed(ctx.session?.user) && ctx.cfg.payoutsEnabled;
  res.json({
    configured: ctx.configured,
    clientId: ctx.configured ? ctx.cfg.clientId : null,
    mode: ctx.demo ? (ctx.configured ? "sandbox" : "simulated") : ctx.configured ? "live" : "unconfigured",
    env: ctx.env,
    authenticated: Boolean(ctx.session),
    payoutsEnabled: payoutReady,
    usdRate: USD_INR_RATE,
    loginMode: resolveLoginEnv() ?? "unconfigured",
    loginConfigured: loginConfigured(),
    capabilities: paypalCapabilities(ctx.env, ctx.session?.user, ctx.demo),
  });
});

// ---- PayPal business reporting (client-credentials scope) ----
// GET /v1/reporting/balances and /v1/reporting/transactions read the business
// account that owns the app's REST credentials. They cannot read the personal
// account a payer signed in with, and this data never enters the local ledger.
app.get("/api/paypal/reporting/overview", async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Sign in with PayPal to read business reporting." });
  if (!envConfigured(session.env)) {
    return res.status(503).json({ error: `PayPal ${session.env} credentials are not configured on this server.` });
  }
  if (!businessAllowed(session.user)) {
    return res.status(403).json({
      error:
        "Business reporting is limited to the account named in PAYPAL_BUSINESS_EMAILS. PayPal Reporting reads the app owner's business account, not the personal account signed in here.",
    });
  }

  const end = isoDate(req.query.end, new Date().toISOString().slice(0, 10));
  const start = isoDate(req.query.start, new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));

  try {
    const [balanceData, txData] = await Promise.all([
      paypal(session.env, "/v1/reporting/balances?currency_code=USD"),
      paypal(
        session.env,
        `/v1/reporting/transactions?start_date=${start}T00:00:00Z&end_date=${end}T23:59:59Z&fields=transaction_info,payer_info&page_size=20&page=1`,
      ),
    ]);

    const balances = (balanceData.balances || []).map((entry) => ({
      currency: entry.currency_code || entry.total_balance?.currency_code || "USD",
      total: Number(entry.total_balance?.value) || 0,
      available: Number(entry.available_balance?.value) || 0,
      withheld: Number(entry.withheld_balance?.value) || 0,
    }));

    const transactions = (txData.transaction_details || []).map((entry) => {
      const info = entry.transaction_info || {};
      const payer = entry.payer_info || {};
      const amount = info.transaction_amount || {};
      const payerName =
        [payer.payer_name?.given_name, payer.payer_name?.surname].filter(Boolean).join(" ") ||
        requireText(payer.payer_name?.alternate_full_name, 120);
      return {
        id: requireText(info.transaction_id, 80),
        date: requireText(info.transaction_initiation_date, 40),
        eventCode: requireText(info.transaction_event_code, 12),
        status: requireText(info.transaction_status, 12),
        amount: Number(amount.value) || 0,
        currency: amount.currency_code || "USD",
        fee: Number(info.fee_amount?.value) || 0,
        subject: requireText(info.transaction_subject || info.transaction_note, 160),
        payerName,
        payerEmail: requireText(payer.email_address, 120),
        outgoing: Boolean(payer.email_address) && payer.email_address.toLowerCase() === session.user.email.toLowerCase(),
      };
    });

    res.json({
      accountId: balanceData.account_id || null,
      asOfTime: balanceData.as_of_time || null,
      refreshedAt: balanceData.last_refresh_time || null,
      balances,
      transactions,
      totalTransactions: Number(txData.total_items) || transactions.length,
      range: { start, end },
      env: session.env,
      note: "Read-only reporting for the PayPal business account that owns this server's app credentials. It is separate from the personal PayPal login used for orders and from the local Wallet Guardian ledger.",
    });
  } catch (err) {
    console.error("[paypal] reporting error", err.message);
    if (err.status === 401 || err.status === 403) {
      return res.status(403).json({
        error:
          "PayPal refused reporting access. Enable Reporting / Transaction Search for this app and confirm its credentials belong to a PayPal business account.",
      });
    }
    res.status(502).json({ error: `PayPal reporting failed: ${err.message}` });
  }
});

// ---- PayPal money flows ----

app.post("/api/paypal/order", async (req, res) => {
  const ctx = paypalContext(req);
  const amountInr = parseInr(req.body?.amountInr);
  const intent = req.body?.intent === "AUTHORIZE" ? "AUTHORIZE" : "CAPTURE";
  const description = requireText(req.body?.description, 127) || "Wallet Guardian payment";
  if (!amountInr) return res.status(400).json({ error: "Enter an amount between ₹0.01 and ₹80,00,000." });
  const amountUsd = usdFromInr(amountInr);
  if (amountUsd < 0.01) return res.status(400).json({ error: "That amount is too small to charge through PayPal." });

  if (!ctx.configured) {
    if (!ctx.demo) return liveUnavailable(res, ctx);
    return res.json({
      id: simId("SIM-ORDER"),
      status: "CREATED",
      env: ctx.env,
      simulated: true,
      amountUsd,
      message: "Sandbox simulation — no real money moves.",
    });
  }

  try {
    const order = await paypal(ctx.env, "/v2/checkout/orders", {
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
    res.json({ id: order.id, status: order.status, env: ctx.env, simulated: false, approvalUrl, amountUsd });
  } catch (err) {
    console.error("[paypal] order error", err.message);
    if (ctx.demo) {
      return res.json({
        id: simId("SIM-ORDER"),
        status: "CREATED",
        env: ctx.env,
        simulated: true,
        amountUsd,
        message: `PayPal sandbox unavailable (${err.message}). Simulated and labelled.`,
      });
    }
    res.status(502).json({ error: `PayPal error: ${err.message}` });
  }
});

app.post("/api/paypal/order/:id/capture", async (req, res) => {
  const ctx = paypalContext(req);
  const orderId = requireText(req.params.id, 80);
  if (!ctx.configured || (ctx.demo && orderId.startsWith("SIM-"))) {
    if (!ctx.demo) return liveUnavailable(res, ctx);
    return res.json({
      id: orderId,
      status: "COMPLETED",
      env: ctx.env,
      simulated: true,
      captureId: simId("SIM-CAPTURE"),
      message: "Sandbox simulation — no real money moved.",
    });
  }
  try {
    const data = await paypal(ctx.env, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      body: {},
      requestId: `wg-cap-${crypto.randomUUID()}`,
    });
    const captureId = data.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    res.json({ id: data.id, status: data.status, env: ctx.env, simulated: false, captureId });
  } catch (err) {
    if (ctx.demo) {
      return res.json({
        id: orderId,
        status: "COMPLETED",
        env: ctx.env,
        simulated: true,
        captureId: simId("SIM-CAPTURE"),
        message: `PayPal sandbox capture failed (${err.message}). Simulated and labelled.`,
      });
    }
    res.status(502).json({ error: `PayPal capture failed: ${err.message}` });
  }
});

app.post("/api/paypal/order/:id/authorize", async (req, res) => {
  const ctx = paypalContext(req);
  const orderId = requireText(req.params.id, 80);
  if (!ctx.configured || (ctx.demo && orderId.startsWith("SIM-"))) {
    if (!ctx.demo) return liveUnavailable(res, ctx);
    return res.json({
      id: orderId,
      status: "COMPLETED",
      env: ctx.env,
      simulated: true,
      authorizationId: simId("SIM-AUTH"),
      message: "Sandbox simulation — no real money is held.",
    });
  }
  try {
    const data = await paypal(ctx.env, `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
      method: "POST",
      body: {},
      requestId: `wg-auth-${crypto.randomUUID()}`,
    });
    const authorizationId = data.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    res.json({ id: data.id, status: data.status, env: ctx.env, simulated: false, authorizationId });
  } catch (err) {
    if (ctx.demo) {
      return res.json({
        id: orderId,
        status: "COMPLETED",
        env: ctx.env,
        simulated: true,
        authorizationId: simId("SIM-AUTH"),
        message: `PayPal sandbox authorization failed (${err.message}). Simulated and labelled.`,
      });
    }
    res.status(502).json({ error: `PayPal authorization failed: ${err.message}` });
  }
});

app.post("/api/paypal/authorization/:id/capture", async (req, res) => {
  const ctx = paypalContext(req);
  const authId = requireText(req.params.id, 80);
  if (!ctx.configured || (ctx.demo && authId.startsWith("SIM-"))) {
    if (!ctx.demo) return liveUnavailable(res, ctx);
    return res.json({ id: simId("SIM-CAPTURE"), status: "COMPLETED", env: ctx.env, simulated: true });
  }
  try {
    const data = await paypal(ctx.env, `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, {
      method: "POST",
      body: { final_capture: true },
      requestId: `wg-auth-cap-${crypto.randomUUID()}`,
    });
    res.json({ id: data.id, status: data.status, env: ctx.env, simulated: false, captureId: data.id });
  } catch (err) {
    if (ctx.demo) {
      return res.json({ id: simId("SIM-CAPTURE"), status: "COMPLETED", env: ctx.env, simulated: true });
    }
    res.status(502).json({ error: `PayPal capture failed: ${err.message}` });
  }
});

app.post("/api/paypal/authorization/:id/void", async (req, res) => {
  const ctx = paypalContext(req);
  const authId = requireText(req.params.id, 80);
  if (!ctx.configured || (ctx.demo && authId.startsWith("SIM-"))) {
    if (!ctx.demo) return liveUnavailable(res, ctx);
    return res.json({ id: authId, status: "VOIDED", env: ctx.env, simulated: true });
  }
  try {
    await paypal(ctx.env, `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, {
      method: "POST",
      requestId: `wg-void-${crypto.randomUUID()}`,
    });
    res.json({ id: authId, status: "VOIDED", env: ctx.env, simulated: false });
  } catch (err) {
    if (ctx.demo) {
      return res.json({ id: authId, status: "VOIDED", env: ctx.env, simulated: true });
    }
    res.status(502).json({ error: `PayPal release failed: ${err.message}` });
  }
});

app.post("/api/paypal/invoice", async (req, res) => {
  const ctx = paypalContext(req);
  if (!ctx.demo && !businessAllowed(ctx.session?.user)) {
    return res.status(403).json({
      error:
        "Invoices are limited to the PayPal business account named in PAYPAL_BUSINESS_EMAILS. Other PayPal logins can ask for money from their own PayPal account.",
    });
  }
  const email = requireText(req.body?.email, 120);
  const name = requireText(req.body?.name, 80) || "Wallet Guardian customer";
  const amountInr = parseInr(req.body?.amountInr);
  const description = requireText(req.body?.description, 100) || "Payment request";
  if (!validEmail(email)) return res.status(400).json({ error: "A valid recipient email is required." });
  if (!amountInr) return res.status(400).json({ error: "Enter a valid invoice amount." });
  const amountUsd = usdFromInr(amountInr);

  if (!ctx.configured) {
    if (!ctx.demo) return liveUnavailable(res, ctx);
    return res.json({
      invoiceId: simId("SIM-INV"),
      status: "DRAFT",
      env: ctx.env,
      simulated: true,
      message: "Sandbox simulation — no PayPal invoice was created.",
    });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const invoice = await paypal(ctx.env, "/v2/invoicing/invoices", {
      method: "POST",
      body: {
        detail: {
          invoice_number: simId("WG"),
          currency_code: "USD",
          note: description,
          payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: today },
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
      await paypal(ctx.env, `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
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
      env: ctx.env,
      simulated: false,
      invoiceUrl: `${ctx.cfg.web}/invoice/p/#${invoiceId}`,
      message,
    });
  } catch (err) {
    if (ctx.demo) {
      return res.json({
        invoiceId: simId("SIM-INV"),
        status: "DRAFT",
        env: ctx.env,
        simulated: true,
        message: `PayPal sandbox invoice failed (${err.message}). Simulated and labelled.`,
      });
    }
    res.status(502).json({ error: `PayPal invoice failed: ${err.message}` });
  }
});

app.post("/api/paypal/payout", async (req, res) => {
  const ctx = paypalContext(req);
  if (!ctx.demo && !businessAllowed(ctx.session?.user)) {
    return res.status(403).json({
      error:
        "Payouts are limited to the PayPal business account named in PAYPAL_BUSINESS_EMAILS. Other PayPal logins can use Pay someone to approve a payment from their own account.",
    });
  }
  const email = requireText(req.body?.email, 120);
  const name = requireText(req.body?.name, 100) || "Payee";
  const amountInr = parseInr(req.body?.amountInr);
  const note = requireText(req.body?.note, 140) || "Wallet Guardian autopay";
  if (!validEmail(email)) return res.status(400).json({ error: "A valid payee email is required." });
  if (!amountInr) return res.status(400).json({ error: "Enter a valid payout amount." });
  const amountUsd = usdFromInr(amountInr);

  const simulatedPayout = (reason) => ({
    batchId: simId("SIM-PAYOUT"),
    status: "SIMULATED",
    env: ctx.env,
    simulated: true,
    message: `${reason} No real money moved.`,
  });

  if (!ctx.configured) {
    if (ctx.demo) return res.json(simulatedPayout("PayPal sandbox credentials are not configured."));
    return liveUnavailable(res, ctx);
  }
  if (!ctx.cfg.payoutsEnabled) {
    if (ctx.demo) return res.json(simulatedPayout("PayPal Payouts are disabled on the sandbox account."));
    return res.status(503).json({
      error: "PayPal Payouts are disabled for this app. Enable Payouts on your PayPal business account, or set PAYPAL_LIVE_PAYOUTS_ENABLED=true.",
    });
  }

  try {
    const data = await paypal(ctx.env, "/v1/payments/payouts", {
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
      env: ctx.env,
      simulated: false,
    });
  } catch (err) {
    console.error("[paypal] payout failed:", err.message);
    if (ctx.demo) return res.json(simulatedPayout(`PayPal sandbox payout failed (${err.message}).`));
    res.status(502).json({ error: `PayPal payout failed: ${err.message}` });
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
  console.log(
    loginConfigured()
      ? credentialSource === "database"
        ? "PayPal live app connected from the local settings database. Real accounts sign in with PayPal and move real money."
        : "PayPal live credentials detected in the environment. Real accounts sign in with PayPal and move real money."
      : `PayPal live is not connected. Open ${APP_BASE_URL}/setup to add your PayPal REST app credentials.`,
  );
  console.log(
    envConfigured("sandbox")
      ? "PayPal sandbox credentials detected. The demo workspace can call the sandbox API."
      : "No sandbox credentials. The demo workspace uses clearly-labelled simulations only.",
  );
  console.log(
    BUSINESS_EMAILS.length
      ? `Business-account payouts, invoices and reporting enabled for ${BUSINESS_EMAILS.length} account(s).`
      : "Business-account payouts, invoices and reporting disabled (set PAYPAL_BUSINESS_EMAILS to enable).",
  );
});
