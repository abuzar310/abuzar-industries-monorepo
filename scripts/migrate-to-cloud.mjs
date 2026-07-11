#!/usr/bin/env node
// One-time (but idempotent) migration: old Supabase REST tables → the new
// cloud-only Postgres schemas (official / unofficial).
//
//   node scripts/migrate-to-cloud.mjs
//
// - Pulls EVERY row from the old project's ab_* / sf_* tables (paged).
// - quotations + invoices land in <schema>.documents with data.kind set.
// - payHolders → pay_holders; everything else maps 1:1.
// - Strips the legacy `synced` flag; preserves ids; upserts (safe to re-run).
// - Copies known settings keys into <schema>.meta if an old settings table exists.
import { Pool } from "pg";

const OLD_URL = "https://rcmqahpvewudytzpjamk.supabase.co";
const OLD_KEY = "sb_publishable_Ejc3ewfGo1JigFRZutBRJA_UWqNJY4Q";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:wFr8qF90tXdkRNz4@db.gvqkyprpcdljcvrcgyyn.supabase.co:5432/postgres";

const APPS = [
  { prefix: "ab_", schema: "official" },
  { prefix: "sf_", schema: "unofficial" },
];

// old store name → new physical table
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
};

const META_KEYS = ["brandMode", "payAccounts", "stockConfig", "autoPostLedger", "suppliersSeeded"];

const pool = new Pool({ connectionString: DATABASE_URL, max: 4, ssl: { rejectUnauthorized: false } });

async function fetchAll(table) {
  // paged pull; a 404 means the table never existed on the old project
  const rows = [];
  const page = 1000;
  for (let off = 0; ; off += page) {
    const r = await fetch(
      `${OLD_URL}/rest/v1/${encodeURIComponent(table)}?select=*&limit=${page}&offset=${off}`,
      { headers: { apikey: OLD_KEY, Authorization: "Bearer " + OLD_KEY } },
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${table}: HTTP ${r.status} ${await r.text()}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < page) return rows;
  }
}

async function upsert(schema, table, id, data) {
  await pool.query(
    `insert into ${schema}.${table} (id, data) values ($1, $2::jsonb)
     on conflict (id) do update set data = excluded.data, deleted_at = null, updated_at = now()`,
    [id, JSON.stringify(data)],
  );
}

async function migrateApp({ prefix, schema }) {
  console.log(`\n=== ${prefix}* → schema "${schema}" ===`);
  const counts = {};
  for (const [store, table] of Object.entries(TABLES)) {
    const rows = await fetchAll(prefix + store);
    if (rows === null) {
      console.log(`  ${prefix + store}: (table not found — skipped)`);
      continue;
    }
    let n = 0;
    for (const row of rows) {
      const data = row?.data;
      if (!data || typeof data !== "object") continue;
      delete data.synced; // legacy local-sync flag — meaningless now
      if (store === "quotations" && !data.kind) data.kind = "quotation";
      if (store === "invoices") data.kind = "invoice";
      const id = String(row.id ?? (store === "stock" ? data.key : data.id) ?? "");
      if (!id) continue;
      await upsert(schema, table, id, data);
      n++;
    }
    counts[table] = (counts[table] || 0) + n;
    console.log(`  ${prefix + store}: ${rows.length} rows → ${schema}.${table} (${n} upserted)`);
  }

  // old settings table (may not exist / be empty) — copy known meta keys
  const settings = await fetchAll(prefix + "settings");
  if (settings === null) {
    console.log(`  ${prefix}settings: (table not found — skipped)`);
  } else {
    let n = 0;
    for (const row of settings) {
      const data = row?.data;
      if (!data || typeof data !== "object") continue;
      // rows can be {id:<key>, data:<value>} or {id:'settings', data:{key:value,…}}
      if (META_KEYS.includes(String(row.id))) {
        await pool.query(
          `insert into ${schema}.meta (k, v) values ($1, $2::jsonb)
           on conflict (k) do update set v = excluded.v, updated_at = now()`,
          [String(row.id), JSON.stringify(data)],
        );
        n++;
      } else {
        for (const k of META_KEYS) {
          if (data[k] !== undefined) {
            await pool.query(
              `insert into ${schema}.meta (k, v) values ($1, $2::jsonb)
               on conflict (k) do update set v = excluded.v, updated_at = now()`,
              [k, JSON.stringify(data[k])],
            );
            n++;
          }
        }
      }
    }
    console.log(`  ${prefix}settings: ${settings.length} rows → ${schema}.meta (${n} keys)`);
  }
  return counts;
}

for (const app of APPS) await migrateApp(app);
await pool.end();
console.log("\nDone.");
