-- One-time schema for the Abuzar / Safa timber apps.
-- Run in Supabase → SQL Editor, OR:  SUPABASE_DB_URL='postgresql://...' bash scripts/db-setup.sh
create table if not exists customers  (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists quotations (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists invoices   (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists stock      (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists expenses   (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists settings   (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists vendors    (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists accounts   (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists ledger     (id text primary key, data jsonb, updated_at timestamptz default now());
create table if not exists sessions   (id text primary key, data jsonb, updated_at timestamptz default now());

alter table customers  enable row level security;
alter table quotations enable row level security;
alter table invoices   enable row level security;
alter table stock      enable row level security;
alter table expenses   enable row level security;
alter table settings   enable row level security;
alter table vendors    enable row level security;
alter table accounts   enable row level security;
alter table ledger     enable row level security;
alter table sessions   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['customers','quotations','invoices','stock','expenses','settings','vendors','accounts','ledger','sessions']
  loop
    execute format('drop policy if exists "abuzar all" on %I', t);
    execute format('create policy "abuzar all" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
