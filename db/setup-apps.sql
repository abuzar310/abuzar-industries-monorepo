-- Per-app isolated tables: ab_* (Abuzar / official) and sf_* (Safa / unofficial).
-- Each with RLS + anon policy + realtime. Run once (idempotent):
--   SUPABASE_DB_URL='postgresql://...' psql "$SUPABASE_DB_URL" -f db/setup-apps.sql
do $$
declare pfx text; t text; tbl text;
begin
  foreach pfx in array array['ab_', 'sf_'] loop
    foreach t in array array['customers','quotations','invoices','stock','expenses','settings','sessions','ledgers','vouchers','collections','payHolders'] loop
      tbl := pfx || t;
      execute format('create table if not exists %I (id text primary key, data jsonb, updated_at timestamptz default now())', tbl);
      execute format('alter table %I enable row level security', tbl);
      execute format('drop policy if exists "abuzar all" on %I', tbl);
      execute format('create policy "abuzar all" on %I for all to anon, authenticated using (true) with check (true)', tbl);
      if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tbl) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end loop;
end $$;
