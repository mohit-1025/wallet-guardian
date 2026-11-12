-- Wallet Guardian — Supabase schema (auth + Postgres + row-level security)
--
-- The shipping build is local-first: user data lives in the browser and PayPal
-- calls go through the server-side API. This migration is the hosted path for
-- teams that want multi-device sync. Apply it in the Supabase SQL editor, then
-- point a storage adapter at these tables. Every user-owned row is protected by
-- RLS; the price catalog is read-only reference data.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  currency text not null default 'INR' check (currency in ('INR', 'USD', 'EUR')),
  monthly_income numeric(14, 2) not null default 0 check (monthly_income >= 0),
  income_type text not null default 'fixed' check (income_type in ('fixed', 'irregular')),
  onboarding_complete boolean not null default false,
  savings_target numeric(14, 2) not null default 0 check (savings_target >= 0),
  fixed_obligations jsonb not null default '[]'::jsonb,
  wallet_balance numeric(14, 2) not null default 0,
  demo boolean not null default false,
  paypal_payer_id text,
  paypal_email text,
  paypal_env text not null default 'sandbox' check (paypal_env in ('sandbox', 'live')),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_paypal_payer_id_key
  on public.profiles (paypal_payer_id)
  where paypal_payer_id is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, paypal_payer_id, paypal_email)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'paypal_payer_id', ''),
    nullif(new.raw_user_meta_data ->> 'paypal_email', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Reference data (read-only to clients)
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('income', 'expense')),
  group_name text not null check (group_name in ('necessities', 'wants', 'savings')),
  color text not null default '#4f46e5',
  icon text not null default 'circle',
  unique (user_id, name, kind)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null check (type in ('wallet', 'bank', 'card', 'paypal')),
  balance numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14, 2) not null check (amount > 0),
  merchant text not null default '',
  occurred_on date not null default current_date,
  payment_method text not null default 'UPI',
  notes text,
  receipt_name text,
  receipt_path text,
  source text not null default 'manual' check (source in ('manual', 'import', 'paypal', 'seed', 'autopay')),
  paypal_order_id text,
  paypal_capture_id text,
  transfer boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_on desc);
create index if not exists transactions_user_category_idx on public.transactions (user_id, category_id);

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (date_trunc('month', month)::date = month),
  income numeric(14, 2) not null default 0,
  split jsonb not null default '{"necessities": 50, "wants": 30, "savings": 20}'::jsonb,
  rollover numeric(14, 2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

create table if not exists public.budget_envelopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  budget_id uuid not null references public.budgets (id) on delete cascade,
  name text not null,
  group_name text not null check (group_name in ('necessities', 'wants', 'savings')),
  category_id uuid references public.categories (id) on delete set null,
  allocated numeric(14, 2) not null default 0 check (allocated >= 0),
  icon text
);

create index if not exists budget_envelopes_budget_idx on public.budget_envelopes (budget_id);

-- ---------------------------------------------------------------------------
-- Goals, subscriptions, bills, reminders
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target numeric(14, 2) not null check (target > 0),
  saved numeric(14, 2) not null default 0 check (saved >= 0),
  deadline date,
  icon text not null default 'target',
  color text not null default '#4f46e5',
  auto_monthly numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  cost numeric(14, 2) not null check (cost >= 0),
  cycle text not null check (cycle in ('monthly', 'yearly')),
  next_billing_date date,
  category text not null default '',
  status text not null default 'active' check (status in ('active', 'cancelled')),
  last_used_days_ago integer not null default 0,
  duplicate_group text,
  price_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  kind text not null default 'bill' check (kind in ('bill', 'emi', 'ticket')),
  amount numeric(14, 2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'due' check (status in ('due', 'paid', 'overdue')),
  autopay boolean not null default false,
  category_id uuid references public.categories (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists bills_user_due_idx on public.bills (user_id, due_date);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person text not null,
  direction text not null check (direction in ('owe', 'owed')),
  amount numeric(14, 2) not null check (amount > 0),
  due_date date,
  status text not null default 'open' check (status in ('open', 'settled')),
  note text,
  paypal_invoice_id text,
  paypal_invoice_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PayPal sandbox records (IDs only — secrets never reach the database or client)
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payee_name text not null,
  payee_email text not null,
  amount numeric(14, 2) not null check (amount > 0),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'quarterly')),
  start_date date not null,
  end_date date,
  next_run_date date not null,
  category_id uuid references public.categories (id) on delete set null,
  note text,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'cancelled')),
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.patient_checkouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant text not null default 'PayPal sandbox',
  item text not null,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null check (status in ('authorized', 'captured', 'voided', 'expired')),
  authorized_at date not null default current_date,
  capture_by date not null,
  category_id uuid references public.categories (id) on delete set null,
  paypal_order_id text,
  authorization_id text,
  capture_id text,
  simulated boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Guardian insights and chat
-- ---------------------------------------------------------------------------
create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  severity text not null check (severity in ('critical', 'warning', 'info', 'positive')),
  title text not null,
  body text not null,
  reason text,
  amount numeric(14, 2),
  action_label text,
  action_href text,
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.guardian_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Smart Shopper catalog — shared reference data, no user_id
-- ---------------------------------------------------------------------------
create table if not exists public.mock_products (
  id text primary key,
  name text not null,
  brand text not null,
  category text not null,
  emoji text not null default '',
  description text not null default '',
  tags text[] not null default '{}'
);

create table if not exists public.mock_prices (
  id text primary key,
  product_id text not null references public.mock_products (id) on delete cascade,
  retailer text not null,
  price numeric(14, 2) not null check (price >= 0),
  shipping numeric(14, 2) not null default 0,
  delivery_days integer not null default 3,
  rating numeric(3, 2) not null default 0,
  return_days integer not null default 7,
  trust_score integer not null default 80 check (trust_score between 0 and 100),
  in_stock boolean not null default true,
  history numeric[] not null default '{}'
);

create table if not exists public.mock_offers (
  id text primary key,
  merchant text not null,
  title text not null,
  description text not null default '',
  category text not null default '',
  discount text not null default '',
  code text,
  expires_at date not null,
  min_spend numeric(14, 2) not null default 0
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_envelopes enable row level security;
alter table public.goals enable row level security;
alter table public.subscriptions enable row level security;
alter table public.bills enable row level security;
alter table public.reminders enable row level security;
alter table public.scheduled_payments enable row level security;
alter table public.patient_checkouts enable row level security;
alter table public.ai_insights enable row level security;
alter table public.guardian_messages enable row level security;
alter table public.mock_products enable row level security;
alter table public.mock_prices enable row level security;
alter table public.mock_offers enable row level security;

-- Profiles: a user can read and update only their own row.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Every user-owned table: full access scoped to the owner.
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'accounts', 'transactions', 'budgets', 'budget_envelopes',
    'goals', 'subscriptions', 'bills', 'reminders', 'scheduled_payments',
    'patient_checkouts', 'ai_insights', 'guardian_messages'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner_all', t
    );
  end loop;
end;
$$;

-- Catalog is readable by any signed-in user and writable only with the service role.
create policy "catalog_read_products" on public.mock_products
  for select to authenticated using (true);
create policy "catalog_read_prices" on public.mock_prices
  for select to authenticated using (true);
create policy "catalog_read_offers" on public.mock_offers
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- 1. PayPal client IDs/secrets belong in edge-function or server environment
--    variables (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET), never in these tables
--    or in client bundles.
-- 2. All amounts are stored in INR to match the app's base currency; the UI
--    converts for display only.
-- 3. The demo build does not call this schema. It exists so a Supabase adapter
--    can be dropped in without reshaping the domain model.
