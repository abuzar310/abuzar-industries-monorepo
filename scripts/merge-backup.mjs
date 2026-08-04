// Merge backup JSON INTO a live DB without regressing newer live rows.
//   * rows missing in target -> inserted
//   * shared ids -> overwritten only when the backup row's updatedAt is >= the live row's
// Usage: node scripts/merge-backup.mjs <backup-file.json>
// Expects DATABASE_URL in env (points to Supabase Postgres, pooler/ipv4)

import { Pool } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const SCHEMA = "unofficial";

const TABLES = {
  customers: "customers",
  suppliers: "suppliers",
  quotations: "documents",
  invoices: "documents",
  stock: "stock",
  expenses: "expenses",
  sessions: "sessions",
  ledgers: "ledgers",
  vouchers: "vouchers",
  collections: "collections",
  payHolders: "pay_holders",
  workers: "workers",
  attendance: "attendance",
  activity: "activity",
  purchases: "purchases",
};

const META_KEYS = ["brandMode", "payAccounts", "stockConfig", "autoPostLedger", "suppliersSeeded"];

let pool = null;
function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, max: 4, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

function ident(s) {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("bad identifier: " + s);
  return s;
}

const iso = (v) => (typeof v === "string" && v) || null;

async function existingVersions(table) {
  const r = await getPool().query(
    `select id, data->>'updatedAt' as up, data->>'date' as d, updated_at from ${SCHEMA}.${ident(table)}`,
  );
  const m = new Map();
  for (const row of r.rows) m.set(row.id, iso(row.up) ?? iso(row.d) ?? row.updated_at?.toISOString() ?? "");
  return m;
}

async function merge() {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error("Usage: node scripts/merge-backup.mjs <backup-file.json>");
    process.exit(1);
  }
  console.log("Reading backup:", backupFile);
  const backup = JSON.parse(readFileSync(resolve(backupFile), "utf-8"));
  console.log("Exported at:", backup.meta?.exportedAt, "| App:", backup.meta?.app);

  let inserted = 0, updated = 0, kept = 0, skipped = 0;

  for (const [store, table] of Object.entries(TABLES)) {
    const rows = backup[store];
    if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

    const live = await existingVersions(table);
    let nIns = 0, nUpd = 0, nKeep = 0;

    for (const row of rows) {
      let data = row?.data;
      let id = row?.id;
      if (data && typeof data === "object") {
        data = { ...data };
        delete data.synced;
        if (store === "quotations" && !data.kind) data.kind = "quotation";
        if (store === "invoices") data.kind = "invoice";
        id = String(id ?? (store === "stock" ? data.key : data.id) ?? "");
      } else {
        data = { ...row };
        id = String(row.id ?? (store === "stock" ? row.key : row.id) ?? "");
        delete data.synced;
        if (store === "quotations" && !data.kind) data.kind = "quotation";
        if (store === "invoices") data.kind = "invoice";
      }
      if (!id || !data || typeof data !== "object") { skipped++; continue; }

      const backupUp = iso(data.updatedAt) ?? iso(data.date) ?? "";
      const liveUp = live.get(id);

      if (liveUp === undefined) {
        await getPool().query(
          `insert into ${SCHEMA}.${ident(table)} (id, data) values ($1, $2::jsonb)`,
          [id, JSON.stringify(data)],
        );
        nIns++;
      } else if (backupUp && backupUp >= liveUp) {
        await getPool().query(
          `update ${SCHEMA}.${ident(table)} set data = $2::jsonb, deleted_at = null where id = $1`,
          [id, JSON.stringify(data)],
        );
        nUpd++;
      } else {
        nKeep++;
      }
    }
    inserted += nIns; updated += nUpd; kept += nKeep;
    console.log(`  ${store.padEnd(11)} ${SCHEMA}.${table}: +${nIns} ins, ~${nUpd} upd, kept ${nKeep}`);
  }

  const settings = backup.meta;
  if (settings && typeof settings === "object") {
    let n = 0;
    for (const k of META_KEYS) {
      if (settings[k] !== undefined) {
        await getPool().query(
          `insert into ${SCHEMA}.meta (k, v) values ($1, $2::jsonb)
           on conflict (k) do update set v = excluded.v, updated_at = now()`,
          [k, JSON.stringify(settings[k])],
        );
        n++;
      }
    }
    console.log(`  meta: ${n} keys written`);
  }

  await pool?.end();
  console.log(`\nDone. inserted=${inserted} updated=${updated} kept=${kept} skipped=${skipped}`);
}

merge().catch((e) => { console.error("FATAL:", e); process.exit(1); });
