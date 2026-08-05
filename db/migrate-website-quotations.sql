-- Add website_quotations tables (idempotent). Safe to re-run.
--   psql "$DATABASE_URL" -f db/migrate-website-quotations.sql

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  sch text;
begin
  foreach sch in array array['official', 'unofficial'] loop
    execute format($f$
      create table if not exists %I.website_quotations (
        id         text primary key,
        data       jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      )$f$, sch);
    execute format(
      'create index if not exists website_quotations_updated_at_idx on %I.website_quotations (updated_at)',
      sch);
    execute format('drop trigger if exists touch_updated_at on %I.website_quotations', sch);
    execute format(
      'create trigger touch_updated_at before update on %I.website_quotations
         for each row execute function public.touch_updated_at()', sch);
  end loop;
end $$;
