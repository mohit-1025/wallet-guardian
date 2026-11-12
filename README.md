# Wallet Guardian

An AI money manager for students, freelancers and young professionals. Track spending, run an adaptive envelope budget that funds savings goals first, chase savings goals, catch subscription creep, split who-owes-who, and run PayPal money flows — all with a grounded AI Guardian that answers only from your own ledger.

Built with React 18 + TypeScript, Vite, Tailwind CSS, shadcn-style Radix components, Recharts, Framer Motion and React Router. Default currency is INR, with an INR / USD / EUR switcher.

> **Sandbox only.** Every account — the demo and every email/password account — talks to the PayPal **sandbox** (`api-m.sandbox.paypal.com`). There is no live-payment code path and no PayPal login. When sandbox credentials are absent, money routes return clearly-labelled simulations instead. No real money can move.

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
| API | http://localhost:8787 | Email accounts, sessions, PayPal sandbox endpoints |

You can run them separately with `npm run dev:web` and `npm run dev:api`.

**Signing in**

- **Create account** — name, email and password. The server validates them, hashes the password with scrypt (16-byte salt, constant-time verification) and stores the account in a local SQLite database (`~/.wallet-guardian/accounts.db` by default). Passwords are never stored or logged in plain text.
- **Sign in** — email and password. The server issues a signed, httpOnly `wg_session` cookie (8 hours, in-memory session store). Wrong credentials always get the same generic error, and unknown emails still run a dummy hash so timing does not reveal which addresses exist.
- **Explore the demo** — no account needed; loads Aarav's workspace with three months of seeded data and sandbox-only payments.
- Signing out clears the server session and the local session pointer. The budget ledger stays in the browser.

**Onboarding (3 steps)**

1. **Connect PayPal sandbox** — enter the sandbox REST app's client ID and secret; the server verifies them against `api-m.sandbox.paypal.com` before accepting. They are encrypted with AES-256-GCM and stored in `settings.db`; the browser never receives them back. This connection powers every simulated PayPal flow for the account. If the server already has sandbox credentials in its environment, that connection wins and onboarding shows it as managed by the server. Set your monthly income here too.
2. **Fixed obligations** — badge-style presets for Rent, Loan/EMI, Utilities, Transport, Education, Health and Other, each with a monthly amount.
3. **Savings goals + AI budget preview** — add any number of named goals with targets and deadlines. The engine funds them first, then sizes necessities to your income and lifestyle, sets a wants ceiling and protects the remainder as savings. No fixed 50/30/20 rule.

### Production build

```bash
npm run build     # tsc -b && vite build
npm start         # serves dist/ plus /api from the same Express process
```

`npm run typecheck` runs the compiler without building.

### Deploy: Vercel frontend + Node API

Vercel's Vite preset serves **only the static frontend**. `server/index.mjs` does not run there, so `/api/*` returns 404 and sign-in/registration fail. PayPal secrets must never be `VITE_*` variables either, because Vite inlines those into the browser bundle.

Run the API on a Node host (Render, Railway, Fly and similar) and keep Vercel as the frontend:

1. Create a Node web service from this repo on the API host. Build with `npm ci && npm run build`, start with `node server/index.mjs --serve-dist`, and set:
   - `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`
   - `SESSION_SECRET` (32-byte random value)
   - `PUBLIC_BASE_URL=https://walletguardian.vercel.app`
   - `APP_BASE_URL=https://walletguardian.vercel.app`
   - `TRUST_PROXY=2` (Vercel edge + host load balancer)
   - `WG_DATA_DIR` on a persistent volume so accounts survive redeploys
   - `WG_SETTINGS_KEY` (64-hex random value) so sandbox credentials connected through onboarding stay decryptable across redeploys
   - optional: `PAYPAL_SANDBOX_PAYOUTS_ENABLED`, `PAYPAL_SANDBOX_INVOICER_EMAIL`, `USD_INR_RATE`
2. In [`vercel.json`](vercel.json), replace `https://YOUR-API-HOST.onrender.com` with the API service's public origin, then redeploy the Vercel project. `vercel.json` cannot read environment variables, so this one URL is committed in the file.
3. Register and sign in at `/login` on the Vercel domain. The browser talks to `/api` on the same origin, so the session cookie stays first-party.

Sessions are held in the API process's memory, so use a single instance and expect a sign-out after redeploys. Accounts persist in SQLite under `WG_DATA_DIR`.

---

## Environment variables

Copy `.env.example` to `.env`. PayPal values are read by `server/index.mjs`; **none are exposed to the browser**. The optional Supabase values are placeholders reserved for a hosted deployment — the app does not read them yet.

```dotenv
PORT=8787

PAYPAL_SANDBOX_CLIENT_ID=
PAYPAL_SANDBOX_CLIENT_SECRET=
PAYPAL_SANDBOX_PAYOUTS_ENABLED=auto
PAYPAL_SANDBOX_INVOICER_EMAIL=

SESSION_SECRET=
PUBLIC_BASE_URL=http://localhost:8787
APP_BASE_URL=http://localhost:5173
TRUST_PROXY=0
USD_INR_RATE=83.2
WG_DATA_DIR=
WG_SETTINGS_KEY=

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `PAYPAL_SANDBOX_CLIENT_ID` / `_SECRET` | optional | Sandbox REST app. Used by every account for Orders, Invoicing, Payouts and Reporting. Blank means labelled simulation |
| `PAYPAL_SANDBOX_PAYOUTS_ENABLED` | no | `false` disables sandbox Payouts; autopay then simulates |
| `PAYPAL_SANDBOX_INVOICER_EMAIL` | no | Invoice sender for sandbox invoices |
| `SESSION_SECRET` | recommended | HMAC key for the session cookie. Random per boot if unset, which signs everyone out on restart |
| `PUBLIC_BASE_URL` | in production | Public URL of the API; defines cookie scope |
| `APP_BASE_URL` | in production | Public URL of the app, used when serving the built bundle |
| `TRUST_PROXY` | behind a proxy | Number of proxy hops to trust for client IPs (rate limiting) |
| `USD_INR_RATE` | no | INR → USD rate used for PayPal charges (default `83.2`) |
| `PORT` | no | API port, default `8787` |
| `WG_DATA_DIR` | production | Directory for the accounts database (default `~/.wallet-guardian`) |
| `WG_SETTINGS_KEY` | production | 64-hex or base64 32-byte key that encrypts the sandbox credentials connected during onboarding. Generated at `<WG_DATA_DIR>/settings.key` (mode `0600`) when unset, so set it explicitly to survive redeploys |
| `VITE_SUPABASE_*` | no | Reserved; the app currently ships local-first (see below) |

---

## Security model

- **"All API keys and PayPal secrets live only in server-side functions, never in client code."** The browser only ever calls `/api/*`; credentials are read from `process.env` or the encrypted store inside `server/index.mjs`. Nothing PayPal-related is in the bundle.
- Sandbox credentials connected through onboarding are verified server-side with PayPal, then encrypted at rest with AES-256-GCM in `settings.db` (`app_settings` table, key from `WG_SETTINGS_KEY` or a generated `settings.key`). `POST /api/paypal/sandbox/connect` never returns them, and there is no endpoint that reads them back. When `PAYPAL_SANDBOX_CLIENT_ID` / `_SECRET` exist in the environment, the environment wins and onboarding refuses to overwrite them.
- Passwords are hashed with `scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte random salt) and verified with `crypto.timingSafeEqual`. Hashes and salts never leave the server; the API never returns them.
- Sign-in issues a signed, httpOnly `wg_session` cookie (`sid.exp.sig`, HMAC-SHA256, 8-hour TTL, `SameSite=Lax`, `Secure` over HTTPS). Sessions live in server memory.
- Login and registration share a dedicated rate limit (20 attempts / 10 minutes per IP) on top of the global 90 req/min limit; JSON bodies are capped at 1 MB.
- Non-GET `/api` requests check the `Origin` header, and responses are sent with `Cache-Control: no-store` plus hardened security headers.
- Only requests carrying `x-wg-account: demo` **and** no session cookie may skip authentication, and they are pinned to the sandbox host. A signed-in account cannot be impersonated by that header.
- PayPal hosts are fixed constants; a request cannot choose its own PayPal host. The API never reads a live credential, and every response reports `env: "sandbox"`.
- `/api/paypal/status` exposes only mode, environment and capability flags — never a secret.
- Inputs are validated and clamped before reaching PayPal; amounts are sent as INR (max ₹80,00,000) and converted server-side.

---

## How data is stored

**Accounts** live in SQLite on the server (`accounts.db` under `WG_DATA_DIR`): id, email (case-insensitive unique), name, password hash and creation time. Delete that file to wipe every account.

**Sandbox credentials** connected at onboarding live in `settings.db` under the same directory, AES-256-GCM encrypted. The encryption key comes from `WG_SETTINGS_KEY` or is generated once as `settings.key`.

**Budget data** is **local-first**: the ledger and a pointer to the signed-in account live in `localStorage` under `walletGuardian.v1.*`, keyed by the server user id. The demo keeps its own `demo_guest` ledger. Clearing browser storage resets the ledger but not the account.

`supabase/schema.sql` contains the production Postgres model — `profiles`, `accounts`, `categories`, `transactions`, `budgets`, `budget_envelopes`, `goals`, `subscriptions`, `bills`, `reminders`, `scheduled_payments`, `patient_checkouts`, `ai_insights`, `guardian_messages` and the mock pricing catalog — with indexes and **row-level security** on every table. Money columns are stored in INR base units; display conversion happens in the client.

Settings → Data & privacy can export your workspace as JSON, load the sample workspace, or reset demo data.

---

## What's inside

| Area | Highlights |
| --- | --- |
| Landing / auth / onboarding | Try-demo entry, email sign-up and sign-in, sandbox badge, 3-step onboarding: connect sandbox + income, obligations with Health/Other presets, multiple savings goals with a live AI budget preview |
| Dashboard | Balance, cash-flow chart, safe-to-spend, envelopes, upcoming bills, AI highlights |
| Transactions | Full CRUD, receipts, search/filter, CSV export (Papaparse), import, AI-style categorization |
| Budget | Adaptive envelopes: goals funded first, sublinear lifestyle scaling for necessities, wants ceiling, savings buffer, per-envelope warnings, rollover, month navigation |
| Savings goals | Multiple goals from onboarding, target dates, AI auto-monthly contributions, progress and projections |
| Money flows | Sidebar tabs for subscriptions, bills, EMIs, autopay, donations, health, education, groceries and others. Every tab has a month calendar (overdue, due soon, upcoming and paid) and Guardian flags for waste and optimisation, plus its own expense list; an expense can optionally carry a PayPal sandbox autopay (receiver, amount, first payment, repeat weekly/monthly), and onboarding obligations are copied into their matching tab. Edit, pause/resume, delete an expense, or remove just its autopay details |
| Subscriptions analysis | Legacy full-page view at `/app/subscriptions`, still reachable by URL: duplicate / unused / price-increase flags, cancellation drafts. The Subscriptions tab carries the same flags plus the shared calendar |
| Bills calendar | Legacy full-page view at `/app/bills`, still reachable by URL: calendar + list views, mark paid, overdue states. The Bills tab now has its own calendar and flags |
| Reminders | Who owes whom, PayPal sandbox invoice links, settle up |
| Goals & analytics | Donut, trend, weekday heatmap, month-over-month, top merchants, savings rate, date filters |
| Wallet | Add money and pay a person through Orders with an approval step; the banner reflects the sandbox or simulation |
| Autopay | Lives in the Autopay tab: recurring payments to a person via sandbox Payouts, or a clearly labelled simulation, with run history |
| AI Guardian | Grounded insights, ledger-grounded chat (every answer cites its transactions), purchase advisor, Patient Checkout authorize → capture/release |
| Smart Shopper | 4–5 retailers per product, transparent score (price 50 / trust 30 / delivery 10 / returns 10), explanations, price-history sparkline, offers and codes |
| Settings | Profile, monthly income, currency, theme, PayPal sandbox status, data export/reset |

Design notes: calm premium fintech palette (indigo / emerald / amber / rose / slate), Plus Jakarta Sans, tabular money figures, rounded-2xl surfaces, light + dark themes, sidebar on desktop and bottom tabs on mobile, count-up numbers, reduced-motion support, WCAG-AA-minded contrast, and color is never the only status signal.

---

## Project structure

```
server/index.mjs          Express API: email accounts + scrypt passwords, signed sessions,
                          encrypted sandbox credential store, PayPal sandbox Orders /
                          Invoicing / Payouts / Reporting, rate limiting, simulation fallback
supabase/schema.sql       Postgres schema, triggers and RLS policies
src/
  App.tsx                 Routes (lazy-loaded app pages) + session guards
  pages/                  landing, auth, onboarding, dashboard, transactions, budget,
                          flows, analytics, subscriptions, bills, reminders, goals, wallet,
                          autopay, guardian, shopper, settings
  components/             UI primitives, layout shell, charts, dialogs
  lib/auth.ts             Server-session client (login, register, restore, logout)
  lib/                    app context + storage, finance engine, guardian and shopper
                          logic, money/FX, seed data, PayPal client, CSV helpers
```

---

## Known limitations

- **Everything is sandbox.** No live PayPal credential is read, and no real money can move. Orders, invoices and payouts hit `api-m.sandbox.paypal.com`; without credentials they return labelled simulations.
- **Sandbox app credentials are configurable.** Set them on the server (`PAYPAL_SANDBOX_CLIENT_ID` / `_SECRET`) or connect them once during onboarding, where they are verified with PayPal and encrypted at rest. With neither, every money route returns `simulated: true` with a message, and the UI labels it. The connection is per server, not per account — every email account uses the same sandbox app.
- **The budget engine is deterministic, not an LLM.** The "AI" is an auditable model: it funds goals first, scales essentials sublinearly with income (`25000 × (income/50000)^0.7`, floored by your fixed obligations), sets a wants ceiling that declines as income rises, and protects the remainder as savings. It explains every figure on the onboarding preview and in the budget notes; it is not a trained model or external service.
- **Payouts and invoices use the app's business account.** They authenticate with the server's sandbox client credentials, so they act on the sandbox business account that owns the app, not the signed-in user's personal account. `PAYPAL_SANDBOX_PAYOUTS_ENABLED=false` turns payouts into simulations.
- **Business reporting is a different account.** `GET /v1/reporting/balances` and `/v1/reporting/transactions` report the sandbox business account that owns the app, may require **Transaction Search** to be enabled, and are shown only in the Wallet page — never mixed into the ledger.
- **Balances are not custodied.** Wallet Guardian records top-ups and payments in its local ledger; it does not hold funds. The wallet balance is bookkeeping, not a stored-value account.
- **Sessions are in memory.** Restarting the API signs everyone out; set `SESSION_SECRET` and use a shared store if you need sessions to survive deploys.
- **Accounts are SQLite.** The accounts database sits on the API host's disk; without a persistent volume, redeploys wipe accounts. Use `WG_DATA_DIR` and a mounted volume in production.
- **Smart Shopper pricing is demo data.** The catalog lives in the seed layer behind a swappable interface; the UI carries a "Demo data · not live prices" badge and values are not scraped from live retailers.
- **Hosted budget storage is not wired.** The app runs on local-first `localStorage`; `supabase/schema.sql` and the `VITE_SUPABASE_*` variables are the path to a hosted deployment, but no Supabase client calls are made yet.
- **AI Guardian is deterministic, not an LLM.** Insights, chat answers and purchase advice are computed from the ledger with rules and aggregations, which is what keeps the numbers grounded — but it answers a fixed set of question shapes rather than free-form conversation.
- FX display rates are fixed (USD 1/83.2, EUR 1/90.4 INR) — there is no live FX feed.
- Internal transfers are excluded from income/expense analytics by design.
