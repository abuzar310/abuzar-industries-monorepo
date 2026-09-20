// Server-side Postgres access — the ONLY way data is read or written.
// The browser never talks to the database directly; every request goes through
// the app's authenticated API routes, which call these helpers.
import { Pool } from "pg";

export type AppSchema = "official" | "unofficial";

/** Client-facing store names → physical tables (quotations + invoices share one table). */
export const STORE_TABLE: Record<string, string> = {
  quotations: "documents",
  invoices: "documents",
  documents: "documents",
  customers: "customers",
  suppliers: "suppliers",
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
  websiteQuotations: "website_quotations",
  carpenters: "carpenters",
  chat: "chat",
  purchaseSheets: "purchase_sheets",
  excelBooks: "excel_books",
};

/** Tables synced to clients (documents once — not once per doc store). */
export const SYNC_TABLES = [
  "documents", "customers", "suppliers", "stock", "expenses", "sessions",
  "ledgers", "vouchers", "collections", "pay_holders", "workers", "attendance",
  "activity", "purchases", "website_quotations", "carpenters", "chat", "purchase_sheets", "excel_books",
] as const;

/** Physical table → the store name clients know it by. */
export const TABLE_STORE: Record<string, string> = {
  documents: "documents",
  customers: "customers",
  suppliers: "suppliers",
  stock: "stock",
  expenses: "expenses",
  sessions: "sessions",
  ledgers: "ledgers",
  vouchers: "vouchers",
  collections: "collections",
  pay_holders: "payHolders",
  workers: "workers",
  attendance: "attendance",
  activity: "activity",
  purchases: "purchases",
  website_quotations: "websiteQuotations",
  carpenters: "carpenters",
  chat: "chat",
  purchase_sheets: "purchaseSheets",
  excel_books: "excelBooks",
};

let _pool: Pool | null = null;

/** Supabase / Vercel drop idle sockets. Retry these once on a fresh pool. */
export function isTransientPgError(e: unknown): boolean {
  const err = e as { message?: string; code?: string };
  return /terminat|ECONNRESET|EPIPE|ECONNREFUSED|ETIMEDOUT|connection timed? ?out|SSL|57P01|08006|08003|57P03|53300|too many clients|Connection ended/i.test(
    `${err?.message || e} ${err?.code || ""}`,
  );
}

function resetPool() {
  const old = _pool;
  _pool = null;
  if (old) void old.end().catch(() => {});
}

export function pool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Serverless + session pooler: hold few sockets, give them back before the
  // pooler kills them (~minutes idle). No error listener → the isolate dies
  // and Safa shows "Startup error" until a new instance boots.
  // Local Postgres has no TLS. Forcing ssl here makes `next dev` refuse 127.0.0.1.
  const local = /localhost|127\.0\.0\.1/.test(url);
  _pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    keepAlive: true,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  _pool.on("error", (err) => {
    console.error("[db] idle client error", err.message);
    resetPool();
  });
  return _pool;
}

export interface Row {
  id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("bad identifier: " + s);
  return s;
};

export const tableRef = (schema: AppSchema, table: string) =>
  `${ident(schema)}.${ident(table)}`;

const chatReady = new Set<string>();
const chatEnsuring = new Map<string, Promise<void>>();
const carpentersReady = new Set<string>();
const carpentersEnsuring = new Map<string, Promise<void>>();
const purchaseSheetsReady = new Set<string>();
const purchaseSheetsEnsuring = new Map<string, Promise<void>>();
const excelBooksReady = new Set<string>();
const excelBooksEnsuring = new Map<string, Promise<void>>();
const websiteQuotationsReady = new Set<string>();
const websiteQuotationsEnsuring = new Map<string, Promise<void>>();

async function ensureRecTable(schema: AppSchema, table: string): Promise<void> {
  const t = tableRef(schema, table);
  await q(`
    create table if not exists ${t} (
      id         text primary key,
      data       jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    )`);
  await q(`create index if not exists ${table}_updated_at_idx on ${t} (updated_at)`);
  await q(
    `create or replace trigger touch_updated_at before update on ${t}
       for each row execute function public.touch_updated_at()`,
  );
}

/** Create chat table if this database was set up before chat existed. SELECT/INSERT only after this. */
export async function ensureChatTable(schema: AppSchema): Promise<void> {
  if (chatReady.has(schema)) return;
  let pending = chatEnsuring.get(schema);
  if (!pending) {
    pending = (async () => {
      await ensureRecTable(schema, "chat");
      chatReady.add(schema);
    })().finally(() => {
      chatEnsuring.delete(schema);
    });
    chatEnsuring.set(schema, pending);
  }
  await pending;
}

/** Landing-site quote inbox — create if DB predates this table. */
export async function ensureWebsiteQuotationsTable(schema: AppSchema): Promise<void> {
  if (websiteQuotationsReady.has(schema)) return;
  let pending = websiteQuotationsEnsuring.get(schema);
  if (!pending) {
    pending = (async () => {
      await ensureRecTable(schema, "website_quotations");
      websiteQuotationsReady.add(schema);
    })().finally(() => {
      websiteQuotationsEnsuring.delete(schema);
    });
    websiteQuotationsEnsuring.set(schema, pending);
  }
  await pending;
}

/** Cut Size Excel books — create if this database predates the table. */
export async function ensureExcelBooksTable(schema: AppSchema): Promise<void> {
  if (excelBooksReady.has(schema)) return;
  let pending = excelBooksEnsuring.get(schema);
  if (!pending) {
    pending = (async () => {
      await ensureRecTable(schema, "excel_books");
      excelBooksReady.add(schema);
    })().finally(() => {
      excelBooksEnsuring.delete(schema);
    });
    excelBooksEnsuring.set(schema, pending);
  }
  await pending;
}

/** Purchase check sheets came after the schema shipped, so a database without the table gets it on first use. */
export async function ensurePurchaseSheetsTable(schema: AppSchema): Promise<void> {
  if (purchaseSheetsReady.has(schema)) return;
  let pending = purchaseSheetsEnsuring.get(schema);
  if (!pending) {
    pending = (async () => {
      await ensureRecTable(schema, "purchase_sheets");
      purchaseSheetsReady.add(schema);
    })().finally(() => {
      purchaseSheetsEnsuring.delete(schema);
    });
    purchaseSheetsEnsuring.set(schema, pending);
  }
  await pending;
}

export async function ensureCarpentersTable(schema: AppSchema): Promise<void> {
  if (carpentersReady.has(schema)) return;
  let pending = carpentersEnsuring.get(schema);
  if (!pending) {
    pending = (async () => {
      await ensureRecTable(schema, "carpenters");
      carpentersReady.add(schema);
    })().finally(() => {
      carpentersEnsuring.delete(schema);
    });
    carpentersEnsuring.set(schema, pending);
  }
  await pending;
}

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  try {
    const r = await pool().query(text, params);
    return r.rows as T[];
  } catch (e) {
    if (!isTransientPgError(e)) throw e;
    resetPool();
    const r = await pool().query(text, params);
    return r.rows as T[];
  }
}

/** All live rows of a table (deleted rows excluded). */
export async function listRows(schema: AppSchema, table: string): Promise<Row[]> {
  try {
    return await q(`select * from ${tableRef(schema, table)} where deleted_at is null order by created_at`);
  } catch (e) {
    // ponytail: excel_books is new; empty until the first write creates the table.
    if (table === "excel_books" && (e as { code?: string }).code === "42P01") return [];
    throw e;
  }
}

/** Rows changed since a timestamp — INCLUDING soft-deleted ones, so every client converges. */
export async function changedRows(schema: AppSchema, table: string, sinceIso: string): Promise<Row[]> {
  try {
    return await q(
      `select * from ${tableRef(schema, table)} where updated_at > $1 order by updated_at`,
      [sinceIso],
    );
  } catch (e) {
    if (table === "excel_books" && (e as { code?: string }).code === "42P01") return [];
    throw e;
  }
}

export async function getRow(schema: AppSchema, table: string, id: string): Promise<Row | undefined> {
  const rows = await q(`select * from ${tableRef(schema, table)} where id = $1`, [id]);
  return rows[0];
}

/** Upsert one record. Un-deletes on write (a saved record is a live record). */
export async function upsertRow(
  schema: AppSchema,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Row> {
  const rows = await q(
    `insert into ${tableRef(schema, table)} (id, data) values ($1, $2::jsonb)
     on conflict (id) do update set data = excluded.data, deleted_at = null, updated_at = now()
     returning *`,
    [id, JSON.stringify(data)],
  );
  return rows[0];
}

/** Soft delete — the row stays forever (auditable, restorable, and visible to change-polling). */
export async function softDeleteRow(schema: AppSchema, table: string, id: string): Promise<void> {
  await q(
    `update ${tableRef(schema, table)} set deleted_at = now(), updated_at = now() where id = $1`,
    [id],
  );
}

export async function metaGetAll(schema: AppSchema): Promise<Record<string, unknown>> {
  const rows = await q<{ k: string; v: unknown }>(`select k, v from ${tableRef(schema, "meta")}`);
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.k] = r.v;
  return out;
}

export async function metaSet(schema: AppSchema, k: string, v: unknown): Promise<void> {
  await q(
    `insert into ${tableRef(schema, "meta")} (k, v) values ($1, $2::jsonb)
     on conflict (k) do update set v = excluded.v, updated_at = now()`,
    [k, JSON.stringify(v ?? null)],
  );
}

export async function nextCounter(schema: AppSchema, name: string): Promise<number> {
  const rows = await q<{ n: string }>(`select ${ident(schema)}.next_counter($1) as n`, [name]);
  return parseInt(rows[0].n, 10);
}

/** Run `fn` while holding a schema-wide advisory lock (serializes number allocation). */
export async function withAdvisoryLock<T>(
  schema: AppSchema,
  key: string,
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  let client: import("pg").PoolClient;
  try {
    client = await pool().connect();
  } catch (e) {
    if (!isTransientPgError(e)) throw e;
    resetPool();
    client = await pool().connect();
  }
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [schema + ":" + key]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
