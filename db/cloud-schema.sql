-- ============================================================================
-- NEW cloud-only schema — the database is the single source of truth.
--
-- Isolated schemas, one per app:
--   official   → Abuzar Industries (invoices + stock/trading + ledger)
--   unofficial → Safa / Cut Size   (quotations + daybook + balances)
--   merged     → Abuzar-testing mix (both apps, own database)
--
-- Design rules (all the old failure modes engineered out):
--   * One `documents` table per app (kind = 'quotation' | 'invoice') — no more
--     two-store id ambiguity or cross-store overwrites.
--   * `updated_at` is stamped by a trigger with the SERVER clock — clients can
--     never write a stale/backdated timestamp that breaks change detection.
--   * Soft delete everywhere: rows get `deleted_at`, they are never hard-DELETEd,
--     so a delete can always be audited/undone and change-polling always sees it.
--   * Numbering is allocated ATOMICALLY inside the database (advisory locks +
--     counters) — two devices can never mint the same number.
--   * No anon access at all: only the app servers connect (postgres role).
--     Browsers go through the app's own authenticated API.
--
-- Apply once:  psql "$DATABASE_URL" -f db/cloud-schema.sql   (idempotent)
-- ============================================================================

create extension if not exists pgcrypto;

-- Server-clock updated_at on every UPDATE.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  sch text;
  t text;
  tables text[] := array[
    'documents', 'customers', 'suppliers', 'stock', 'expenses', 'sessions',
    'ledgers', 'vouchers', 'collections', 'pay_holders',
    -- attendance: workers (name + daily rate) and one row per worker per day
    'workers', 'attendance',
    -- owner audit trail (login / logout / create / delete)
    'activity',
    -- unofficial Buys: timber-in purchase ledger rows (from-name / bill / cft)
    'purchases',
    -- landing-site quote submissions (isolated until Import to Quotation)
    'website_quotations',
    -- standalone carpenter contacts (Cut Size; not tied to a customer)
    'carpenters',
    -- owner <-> manager in-app chat
    'chat',
    -- Cut Size Purchase check: a supplier measurement list saved as our own sheet
    'purchase_sheets',
    -- Cut Size Excel: opened workbooks (Univer snapshots)
    'excel_books'
  ];
begin
  foreach sch in array array['official', 'unofficial', 'merged'] loop
    execute format('create schema if not exists %I', sch);

    foreach t in array tables loop
      execute format($f$
        create table if not exists %I.%I (
          id         text primary key,
          data       jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          deleted_at timestamptz
        )$f$, sch, t);
      execute format('create index if not exists %I on %I.%I (updated_at)',
        t || '_updated_at_idx', sch, t);
      execute format('drop trigger if exists touch_updated_at on %I.%I', sch, t);
      execute format(
        'create trigger touch_updated_at before update on %I.%I
           for each row execute function public.touch_updated_at()', sch, t);
    end loop;

    -- documents: index the hot lookups
    execute format(
      'create index if not exists documents_kind_idx on %I.documents ((data->>''kind''))', sch);

    -- shared business settings (brand mode, pay accounts, stock config, …)
    execute format($f$
      create table if not exists %I.meta (
        k          text primary key,
        v          jsonb,
        updated_at timestamptz not null default now()
      )$f$, sch);
    execute format('drop trigger if exists touch_updated_at on %I.meta', sch);
    execute format(
      'create trigger touch_updated_at before update on %I.meta
         for each row execute function public.touch_updated_at()', sch);

    -- atomic counters (voucher numbers, anything sequential)
    execute format($f$
      create table if not exists %I.counters (
        name text primary key,
        n    bigint not null default 0
      )$f$, sch);

    -- app users (Owner / Manager) — passwords are scrypt-hashed by the server
    execute format($f$
      create table if not exists %I.users (
        id         text primary key,
        name       text not null,
        role       text not null check (role in ('owner', 'manager')),
        password   text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )$f$, sch);
    execute format('drop trigger if exists touch_updated_at on %I.users', sch);
    execute format(
      'create trigger touch_updated_at before update on %I.users
         for each row execute function public.touch_updated_at()', sch);
  end loop;
end $$;

-- Atomic counter bump (single-statement upsert = race-free).
create or replace function official.next_counter(cname text) returns bigint
language sql as $$
  insert into official.counters (name, n) values (cname, 1)
  on conflict (name) do update set n = official.counters.n + 1
  returning n;
$$;

create or replace function unofficial.next_counter(cname text) returns bigint
language sql as $$
  insert into unofficial.counters (name, n) values (cname, 1)
  on conflict (name) do update set n = unofficial.counters.n + 1
  returning n;
$$;

create or replace function merged.next_counter(cname text) returns bigint
language sql as $$
  insert into merged.counters (name, n) values (cname, 1)
  on conflict (name) do update set n = merged.counters.n + 1
  returning n;
$$;
