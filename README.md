# Wallet Guardian

An AI money manager for students, freelancers and young professionals. Track spending, run a 50/30/20 envelope budget, chase savings goals, catch subscription creep, split who-owes-who, and run PayPal money flows — all with a grounded AI Guardian that answers only from your own ledger.

Built with React 18 + TypeScript, Vite, Tailwind CSS, shadcn-style Radix components, Recharts, Framer Motion and React Router. Default currency is INR, with an INR / USD / EUR switcher.

> **Two payment environments.** Demo visitors never leave the PayPal sandbox (and fall back to a clearly labelled simulation when no sandbox app is configured). PayPal accounts use **live PayPal automatically** once live credentials are present: name, email, payer ID and verification status come from PayPal, and every payment needs the payer's approval on PayPal. The demo never touches live PayPal.

---

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts both processes:

| Process | URL | What it does |
| --- | --- | --- |
| Vite | http://localhost:5173 | Web app (proxies `/api` to the API server) |
| API | http://localhost:8787 | PayPal endpoints, OAuth sign-in, session cookies |

You can run them separately with `npm run dev:web` and `npm run dev:api`.

**Signing in**

- **Continue with PayPal** — the server starts PayPal's OAuth (Log in with PayPal) flow, exchanges the code server-side, and issues a signed, httpOnly session cookie (`wg_session`, 8 hours, in-memory). The client never sees a PayPal token or secret.
- **Connect the app once** — PayPal sign-in needs one REST app to act as the OAuth client. Open [http://localhost:5173/setup](http://localhost:5173/setup), register `http://localhost:8787/api/auth/paypal/callback` as the app's redirect URI, and paste the Live Client ID and Secret. The server verifies them with PayPal, encrypts them, and stores them in a local SQLite settings database (`~/.wallet-guardian/settings.db` by default). They are used immediately, with no restart and no browser access to the secret. The equivalent `PAYPAL_LIVE_CLIENT_ID` / `_SECRET` environment variables still work.
- **Explore the demo** — no account needed; loads Aarav's workspace with three months of seeded data and sandbox-only payments.
- There is no email/password sign-up. PayPal owns authentication; Wallet Guardian only keeps the local budget ledger.

### Production build

```bash
npm run build     # tsc -b && vite build
npm start         # serves dist/ plus /api from the same Express process
```

`npm run typecheck` runs the compiler without building.

---

## Environment variables

Copy `.env.example` to `.env`. PayPal values are read by `server/index.mjs`; **none are exposed to the browser**. The optional Supabase values are placeholders reserved for a hosted deployment — the app does not read them yet.

```dotenv
PORT=8787

PAYPAL_LIVE_CLIENT_ID=
PAYPAL_LIVE_CLIENT_SECRET=
PAYPAL_LIVE_PAYOUTS_ENABLED=auto
PAYPAL_INVOICER_EMAIL=

PAYPAL_SANDBOX_CLIENT_ID=
PAYPAL_SANDBOX_CLIENT_SECRET=
PAYPAL_SANDBOX_PAYOUTS_ENABLED=auto
PAYPAL_SANDBOX_INVOICER_EMAIL=

PAYPAL_BUSINESS_EMAILS=

SESSION_SECRET=
PUBLIC_BASE_URL=http://localhost:8787
APP_BASE_URL=http://localhost:5173
USD_INR_RATE=83.2
WG_DATA_DIR=
WG_SETTINGS_KEY=

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `PAYPAL_LIVE_CLIENT_ID` / `_SECRET` | optional | Live REST app with **Log in with PayPal** enabled. Can be set here or entered once at `/setup` |
| `PAYPAL_LIVE_PAYOUTS_ENABLED` | no | `false` disables live Payouts; autopay then refuses instead of simulating |
| `PAYPAL_INVOICER_EMAIL` | no | Live invoice sender for the business account |
| `PAYPAL_SANDBOX_CLIENT_ID` / `_SECRET` | no | Sandbox REST app, used **only by the demo workspace**. Blank means labelled simulation |
| `PAYPAL_SANDBOX_PAYOUTS_ENABLED` | no | `false` disables sandbox Payouts; demo autopay then simulates |
| `PAYPAL_SANDBOX_INVOICER_EMAIL` | no | Invoice sender for sandbox invoices |
| `PAYPAL_BUSINESS_EMAILS` | for business features | Comma-separated PayPal emails allowed to use **business-account** payouts, invoices and reporting. These use the app's client credentials, so they act on the business account that owns the app, not a signed-in payer's personal account |
| `SESSION_SECRET` | recommended | HMAC key for the sign-in cookie. Random per boot if unset, which signs everyone out on restart |
| `PUBLIC_BASE_URL` | in production | Public URL of the API; must match the PayPal redirect URI |
| `APP_BASE_URL` | in production | Where the server redirects after sign-in (Vite on `:5173` in dev) |
| `USD_INR_RATE` | no | INR → USD rate used for PayPal charges (default `83.2`) |
| `PORT` | no | API port, default `8787` |
| `WG_DATA_DIR` | no | Directory for the encrypted settings database and its key (default `~/.wallet-guardian`) |
| `WG_SETTINGS_KEY` | no | 32-byte key (64 hex chars or base64) that encrypts saved PayPal credentials. Generated into `settings.key` on first run when unset |
| `VITE_SUPABASE_*` | no | Reserved; the app currently ships local-first (see below) |

**Sign-in setup:** PayPal OAuth always requires one app registration — there is no zero-credential mode. In the PayPal Developer Dashboard, enable **Log in with PayPal** on your app and register the redirect URI `${PUBLIC_BASE_URL}/api/auth/paypal/callback` (e.g. `http://localhost:8787/api/auth/paypal/callback`). Then open `/setup` in the app and paste the Live Client ID and Secret. The server verifies them against PayPal before saving them encrypted; the setup endpoint is local-only and closes once credentials exist. Without credentials, `/login` offers the setup link while the demo keeps working.

---

## Security model

- **"All API keys and PayPal secrets live only in server-side functions, never in client code."** The browser only ever calls `/api/*`; client IDs and secrets are read from `process.env` inside `server/index.mjs`, or saved once through `/setup` and encrypted at rest (AES-256-GCM) in the server's local SQLite settings database. The secret is never returned to the browser or included in the bundle; `/setup` is local-only and refuses to overwrite existing credentials.
- Sign-in uses PayPal's authorization-code flow with `openid profile email` plus the `paypalattributes` scope for payer ID and verification status. The code is exchanged server-to-server, and only a signed, httpOnly `wg_session` cookie reaches the browser. Sessions and PayPal access tokens stay in server memory.
- PayPal shares identity data only. A personal account's balance and transaction history are not exposed by **Log in with PayPal**, so Wallet Guardian never claims to show them; the wallet balance and activity are the app's local ledger.
- Business payouts, invoices and reporting are allowlisted by `PAYPAL_BUSINESS_EMAILS`, and reporting uses the app's client-credential token against the business account that owns the app. It never merges into the personal ledger and is impossible for a non-allowlisted login to use.
- OAuth `state` is HMAC-signed with a 10-minute TTL, cookies are `SameSite=Lax` (and `Secure` behind HTTPS), and non-GET `/api` requests check the `Origin` header.
- **Real accounts never fall back to simulation.** If the PayPal session expired or the process restarted, the browser sends `x-wg-account: paypal` and the API answers `401` instead of inventing a fake success. Only requests carrying `x-wg-account: demo` may simulate, and those are pinned to the sandbox host.
- `/api/paypal/status` exposes only mode, environment, the public client ID and capability flags — never a secret. The setup page returns only a masked client ID.
- Every `/api` request is rate limited (90 req/min/IP) and JSON bodies are capped at 1 MB. Inputs are validated and clamped before reaching PayPal; amounts are sent as INR and converted server-side.
- Environment hosts are fixed constants (`api-m.sandbox.paypal.com` / `api-m.paypal.com`); a request cannot choose its own PayPal host.

---

## How data is stored

The shipped app is **local-first for budget data**: the ledger and a pointer to the signed-in payer live in `localStorage` under `walletGuardian.v1.*`. There are no stored passwords. A PayPal identity is keyed by the PayPal payer ID the server returns from `/api/auth/me`; the server session itself is a memory-only httpOnly cookie, so a server restart (or 8-hour expiry) requires signing in again. The demo keeps its own `demo_guest` ledger.

`supabase/schema.sql` contains the production Postgres model — `profiles` (including `paypal_payer_id` and `paypal_email`), `accounts`, `categories`, `transactions`, `budgets`, `budget_envelopes`, `goals`, `subscriptions`, `bills`, `reminders`, `scheduled_payments`, `patient_checkouts`, `ai_insights`, `guardian_messages` and the mock pricing catalog — with indexes and **row-level security** on every table. The `handle_new_user` trigger creates the profile row on signup and copies the PayPal payer ID from auth metadata when present. Money columns are stored in INR base units; display conversion happens in the client.

Settings → Data & privacy can export your workspace as JSON, load the sample workspace, or reset demo data.

---

## What's inside

| Area | Highlights |
| --- | --- |
| Landing / auth / onboarding | Try-demo entry, Log in with PayPal, environment badge (sandbox vs live), 3-step onboarding that feeds the budget engine |
| Dashboard | Balance, cash-flow chart, safe-to-spend, envelopes, upcoming bills, AI highlights |
| Transactions | Full CRUD, receipts, search/filter, CSV export (Papaparse), import, AI-style categorization |
| Budget | 50/30/20 envelope groups, per-envelope warnings, rollover, month navigation |
| Savings goals | Target dates, auto-monthly contributions, progress and projections |
| Subscriptions | Duplicate / unused / price-increase flags, cancellation drafts |
| Bills | Calendar + list views, mark paid, overdue states |
| Reminders | Who owes whom, PayPal invoice links, settle up |
| Goals & analytics | Donut, trend, weekday heatmap, month-over-month, top merchants, savings rate, date filters |
| Wallet | Add money and pay a person through Orders with an approval step; the banner reflects the live or sandbox environment |
| Autopay | Recurring payments to a person via Payouts (business account), or a clearly labelled simulation in the demo |
| AI Guardian | Grounded insights, ledger-grounded chat (every answer cites its transactions), purchase advisor, Patient Checkout authorize → capture/release |
| Smart Shopper | 4–5 retailers per product, transparent score (price 50 / trust 30 / delivery 10 / returns 10), explanations, price-history sparkline, offers and codes |
| Settings | Profile, monthly income and savings target, currency, theme, PayPal status, data export/reset |

Design notes: calm premium fintech palette (indigo / emerald / amber / rose / slate), Plus Jakarta Sans, tabular money figures, rounded-2xl surfaces, light + dark themes, sidebar on desktop and bottom tabs on mobile, count-up numbers, reduced-motion support, WCAG-AA-minded contrast, and color is never the only status signal.

---

## Project structure

```
server/index.mjs          Express API: PayPal OAuth login, signed sessions, Orders /
                          Invoicing / Payouts, live accounts + demo sandbox, rate limiting
supabase/schema.sql       Postgres schema, triggers and RLS policies
src/
  App.tsx                 Routes (lazy-loaded app pages) + session guards
  pages/                  landing, auth, onboarding, dashboard, transactions, budget,
                          analytics, subscriptions, bills, reminders, goals, wallet,
                          autopay, guardian, shopper, settings
  components/             UI primitives, layout shell, charts, dialogs
  lib/auth.ts             Server-session client (start login, /auth/me, logout)
  lib/                    app context + storage, finance engine, guardian and shopper
                          logic, money/FX, seed data, PayPal client, CSV helpers
```

---

## Known limitations

- **PayPal cannot be charged silently.** Signing in with PayPal does not grant a reusable charge mandate. Each order and authorization must be approved on PayPal; the server then captures it. Payouts and Invoicing act through a **business** account, so live autopay and live invoices are limited to the PayPal email(s) listed in `PAYPAL_BUSINESS_EMAILS`; every other login uses **Wallet → Pay someone**, which the payer approves.
- **PayPal does not expose personal balances or history.** Log in with PayPal returns identity (name, email, payer ID, verification status), not account balance or transaction history. Wallet Guardian labels its balance/activity as a local ledger and never presents it as a PayPal-reported figure.
- **Business reporting is a different account.** `GET /v1/reporting/balances` and `/v1/reporting/transactions` authenticate with the app's client credentials, so they report the **business account that owns the app**. They are not available to personal PayPal accounts, may require **Transaction Search** to be enabled for the app, and Transaction Search can lag by a few hours. Use `PAYPAL_BUSINESS_EMAILS` to decide who may see that data; it appears only in the Wallet page and is never mixed into the ledger.
- **Real balances are not custodied.** Wallet Guardian records top-ups and payments in its local ledger; it does not hold funds. A live "wallet balance" mirrors what you have approved into the ledger, so treat it as bookkeeping, not a stored-value account.
- **A PayPal app registration is still required.** There is no zero-configuration OAuth: a live client ID/secret must exist on the server. Connect it once at `/setup` (or with environment variables); without it, `/login` links to setup and the demo remains available.
- **Live sign-in is untested until credentials exist.** Without a live PayPal app, real authenticated API calls return `503` (never a simulation); the demo keeps working against the sandbox or labelled simulation.
- **Saved credentials live beside their key.** The settings database encrypts the client secret with AES-256-GCM using a 32-byte key in `~/.wallet-guardian/settings.key` (or `WG_SETTINGS_KEY`). Treat both files as secrets; losing the key means reconnecting at `/setup`. Setup is local-only by design; a remote deployment should use environment variables or a protected secrets store.
- **Sessions are in memory.** Restarting the API signs everyone out; set `SESSION_SECRET` and use a shared store if you need sessions to survive deploys.
- **Smart Shopper pricing is demo data.** The catalog lives in the seed layer behind a swappable interface; the UI carries a "Demo data · not live prices" badge and values are not scraped from live retailers.
- **Hosted budget storage is not wired.** The app runs on local-first `localStorage`; `supabase/schema.sql` and the `VITE_SUPABASE_*` variables are the path to a hosted deployment, but no Supabase client calls are made yet.
- **AI Guardian is deterministic, not an LLM.** Insights, chat answers and purchase advice are computed from the ledger with rules and aggregations, which is what keeps the numbers grounded — but it answers a fixed set of question shapes rather than free-form conversation.
- FX display rates are fixed (USD 1/83.2, EUR 1/90.4 INR) — there is no live FX feed.
- Internal transfers are excluded from income/expense analytics by design.
