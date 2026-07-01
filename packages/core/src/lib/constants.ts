import type { Section } from "./types";

export const CO = {
  name: "Abuzar Industries",
  addr: "KSSIDC Industrial Area, DVG Road, Chitradurga, Karnataka – 577501",
  phone: "9845378626",
  web: "www.abuzarindustries.in",
  gstin: "29AROPA1101B1ZK",
} as const;

export const STATUSES = [
  "Draft",
  "Sent",
  "Follow-up Pending",
  "Confirmed",
  "Rejected",
  "Converted to Invoice",
] as const;

/**
 * Cloud settings sourced from environment (see .env.example), so secrets never
 * live in source. NEXT_PUBLIC_* vars are inlined into the client bundle at build
 * time; the Supabase publishable key is browser-safe by design. With no env set,
 * url/key are empty and the app falls back to per-device manual setup in Settings.
 */
export const BAKED = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  // App access is gated by the local user lock (Afsar / Ajju); cloud sync runs on
  // the anon publishable key, so the Supabase email gate stays off by default.
  secure: false,
  openLock: "never" as const,
  adminEmails: (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

export const SAMPLE_SECTIONS: Section[] = [
  {
    name: "Teak",
    rate: 3600,
    rows: [
      { l: 7, w: 6, t: 4, pcs: 3 },
      { l: 6, w: 6, t: 4, pcs: 2 },
      { l: 4, w: 6, t: 4, pcs: 1 },
      { l: 7, w: 6, t: 3, pcs: 2 },
      { l: 4, w: 6, t: 3, pcs: 2 },
      { l: 7, w: 5, t: 3, pcs: 2 },
      { l: 4, w: 5, t: 3, pcs: 2 },
    ],
  },
  {
    name: "Neem",
    rate: 900,
    rows: [
      { l: 7, w: 5, t: 3, pcs: 6 },
      { l: 5, w: 5, t: 3, pcs: 4 },
      { l: 6, w: 5, t: 3, pcs: 4 },
      { l: 4, w: 5, t: 3, pcs: 19 },
      { l: 3, w: 5, t: 3, pcs: 4 },
      { l: 2, w: 5, t: 3, pcs: 6 },
    ],
  },
];

// --- Supabase SQL helper snippets (shown in Settings) ---

export const SETUP_SQL = `-- Supabase -> SQL Editor -> New query -> paste -> Run
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

drop policy if exists "abuzar all" on customers;
drop policy if exists "abuzar all" on quotations;
drop policy if exists "abuzar all" on invoices;
drop policy if exists "abuzar all" on stock;
drop policy if exists "abuzar all" on expenses;
drop policy if exists "abuzar all" on settings;
drop policy if exists "abuzar all" on vendors;
drop policy if exists "abuzar all" on accounts;
drop policy if exists "abuzar all" on ledger;
drop policy if exists "abuzar all" on sessions;

create policy "abuzar all" on customers  for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on quotations for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on invoices   for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on stock      for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on expenses   for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on settings   for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on vendors    for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on accounts   for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on ledger     for all to anon, authenticated using (true) with check (true);
create policy "abuzar all" on sessions   for all to anon, authenticated using (true) with check (true);`;

export const LOCK_SQL = `-- Lock the database: only logged-in users can read/write
drop policy if exists "abuzar all"  on customers;
drop policy if exists "abuzar all"  on quotations;
drop policy if exists "abuzar all"  on invoices;
drop policy if exists "abuzar all"  on stock;
drop policy if exists "abuzar auth" on customers;
drop policy if exists "abuzar auth" on quotations;
drop policy if exists "abuzar auth" on invoices;
drop policy if exists "abuzar auth" on stock;
drop policy if exists "abuzar auth" on settings;

create policy "abuzar auth" on customers  for all to authenticated using (true) with check (true);
create policy "abuzar auth" on quotations for all to authenticated using (true) with check (true);
create policy "abuzar auth" on invoices   for all to authenticated using (true) with check (true);
create policy "abuzar auth" on stock      for all to authenticated using (true) with check (true);`;

export const WIPE_SQL = `-- Delete ALL data from the cloud
truncate table quotations, invoices, customers, stock;

-- If truncate is blocked, use this instead:
-- delete from quotations;
-- delete from invoices;
-- delete from customers;
-- delete from stock;`;
