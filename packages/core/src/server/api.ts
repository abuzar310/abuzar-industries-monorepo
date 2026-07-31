// The app's data API — every read and write in the product flows through here.
// The database is the single source of truth; the browser keeps only an
// in-memory cache that is filled from /bootstrap and kept fresh via /changes.
//
// Routes (all JSON, all under the app's /api/data):
//   POST  auth/login        { userId, password }        → sets session cookie
//   POST  auth/logout                                   → clears cookie
//   GET   auth/me                                       → { user | null }
//   POST  auth/password     { password }                → change own password
//   GET   bootstrap                                     → full dataset + meta + user
//   GET   changes?since=ISO                             → rows changed since (incl. deletes)
//   PUT   rec/<store>/<id>  { ...record }               → upsert
//   DELETE rec/<store>/<id>                             → soft delete
//   PUT   meta/<key>        { v }                       → shared setting
//   POST  rpc/create-doc    { data }                    → atomic id/number + insert
//   POST  rpc/next-voucher-no { type }                  → atomic counter
//   POST  rpc/next-invoice-number { series }            → atomic serial (sell|buy|rent)
//
// No Supabase client keys, no anon access, no client-side SQL: the only secret
// is DATABASE_URL and it never leaves the server.
import type { NextRequest } from "next/server";
import {
  changedRows,
  getRow,
  listRows,
  metaGetAll,
  metaSet,
  nextCounter,
  softDeleteRow,
  upsertRow,
  q as sql,
  tableRef,
  withAdvisoryLock,
  SYNC_TABLES,
  STORE_TABLE,
  TABLE_STORE,
  type AppSchema,
  type Row,
} from "./db";
import {
  changeUserPassword,
  checkLogin,
  clearSessionCookie,
  makeSessionToken,
  readSessionToken,
  sessionCookie,
  SESSION_COOKIE,
  type AppUser,
} from "./auth";
import {
  formatSeriesNumber,
  newInvoiceUid,
  nextFreeLiveDisplay,
  seriesNumeric,
  seriesOf,
  type InvoiceSeries,
} from "../lib/invoice-id";
import { fyLabel } from "../lib/numbering";
import { pad } from "../lib/calc";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const err = (status: number, message: string) => json({ error: message }, status);

type AnyRec = Record<string, unknown>;

/** Split raw document rows into the two client-facing stores. */
function splitDocs(rows: Row[]): { quotations: AnyRec[]; invoices: AnyRec[] } {
  const quotations: AnyRec[] = [];
  const invoices: AnyRec[] = [];
  for (const r of rows) {
    const d = r.data as AnyRec;
    (d.kind === "invoice" ? invoices : quotations).push(d);
  }
  return { quotations, invoices };
}

function userFrom(req: NextRequest): AppUser | null {
  return readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Append one owner-visible audit row (login / logout / create / delete). Never throws. */
async function writeActivity(
  schema: AppSchema,
  opts: {
    by: string;
    byName: string;
    action: "login" | "logout" | "create" | "delete";
    store?: string;
    targetId?: string;
    summary: string;
  },
): Promise<void> {
  try {
    const id = "act_" + crypto.randomUUID().replace(/-/g, "");
    const at = new Date().toISOString();
    await upsertRow(schema, "activity", id, {
      id,
      at,
      by: opts.by,
      byName: opts.byName,
      action: opts.action,
      store: opts.store || "",
      targetId: opts.targetId || "",
      summary: opts.summary,
      createdAt: at,
      updatedAt: at,
    });
  } catch {
    /* audit must never break the real request */
  }
}

function storeLabel(store: string): string {
  const m: Record<string, string> = {
    quotations: "quotation",
    invoices: "invoice",
    documents: "document",
    customers: "customer",
    suppliers: "supplier",
    expenses: "expense",
    sessions: "daybook session",
    stock: "stock",
    workers: "worker",
    attendance: "attendance",
    ledgers: "ledger",
    vouchers: "voucher",
    collections: "collection",
    payHolders: "pay holder",
    pay_holders: "pay holder",
  };
  return m[store] || store;
}

function recordSummary(store: string, data: AnyRec | null | undefined, id: string): string {
  if (!data) return storeLabel(store) + " " + id;
  const kind = storeLabel(store);
  const name =
    (data.customerName as string) ||
    (data.name as string) ||
    (data.label as string) ||
    (data.note as string) ||
    (data.number as string) ||
    "";
  const num = (data.displayNumber as string) || (data.number as string) || "";
  const amt = data.amount != null ? " ₹" + Number(data.amount) : "";
  return [kind, num && ("#" + num), name, amt].filter(Boolean).join(" · ") || kind + " " + id;
}

// ---- atomic document creation (collision-proof numbering) ----

const isLive = (d: AnyRec) => !d.deletedAt && !d.purgedAt;

/** Live display serials already taken in one invoice series (sell / buy / rent).
 *  `exceptId` skips one document — the invoice being re-numbered itself, so its own
 *  (possibly still-saving) current number can never block its new allocation. */
async function takenInSeries(
  client: import("pg").PoolClient,
  table: string,
  series: InvoiceSeries,
  exceptId?: string,
): Promise<Set<number>> {
  const rows = await client.query(
    `select id, data from ${table} where data->>'kind' = 'invoice' and deleted_at is null`,
  );
  const taken = new Set<number>();
  for (const row of rows.rows) {
    if (exceptId && row.id === exceptId) continue;
    const d = row.data as AnyRec;
    if (!isLive(d)) continue;
    if (seriesOf(d as { tradeType?: "sell" | "buy"; rented?: boolean }) !== series) continue;
    const n = seriesNumeric(series, d.number);
    if (n > 0) taken.add(n);
  }
  return taken;
}

async function createDocAtomic(schema: AppSchema, data: AnyRec): Promise<AnyRec> {
  const kind = data.kind === "invoice" ? "invoice" : "quotation";
  return withAdvisoryLock(schema, "doc-number:" + kind, async (client) => {
    const t = tableRef(schema, "documents");
    if (kind === "quotation") {
      // Quotation id = number = "<fy>-NNN". NNN is strictly above every number ever
      // issued this FY (live, trashed or purged rows all stay in the table), so a
      // new quotation can never collide with or overwrite an old one.
      const fy = fyLabel();
      const r = await client.query(
        `select coalesce(max((substring(id from '^${fy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$'))::int), 0) as mx
           from ${t} where data->>'kind' = 'quotation'`,
      );
      const n = (parseInt(r.rows[0]?.mx, 10) || 0) + 1;
      const id = fy + "-" + pad(n, 3);
      const doc = { ...data, id, number: id, kind };
      const ins = await client.query(
        `insert into ${t} (id, data) values ($1, $2::jsonb) returning data`,
        [id, JSON.stringify(doc)],
      );
      return ins.rows[0].data as AnyRec;
    }

    // Invoice: permanent UID for the row key; the printed number is a clean serial
    // per SERIES (sales · purchases · rented — each its own numbering, never mixed)
    // with hole reuse, computed over the LIVE series (same rule on every device
    // because it now runs in exactly one place — here).
    const series = seriesOf(data as { tradeType?: "sell" | "buy"; rented?: boolean });
    const taken = await takenInSeries(client, t, series);
    const wanted = String(data.number || "").trim();
    const number = wanted || formatSeriesNumber(series, nextFreeLiveDisplay(taken, series));
    const id = newInvoiceUid();
    const doc = { ...data, id, number, kind, tradeType: series === "buy" ? "buy" : "sell" };
    const ins = await client.query(
      `insert into ${t} (id, data) values ($1, $2::jsonb) returning data`,
      [id, JSON.stringify(doc)],
    );
    return ins.rows[0].data as AnyRec;
  });
}

/** Next free display number in a series WITHOUT creating a document — used when an
 *  existing invoice moves between series (e.g. toggled to/from Rented). */
async function nextNumberAtomic(
  schema: AppSchema,
  series: InvoiceSeries,
  exceptId?: string,
): Promise<string> {
  return withAdvisoryLock(schema, "doc-number:invoice", async (client) => {
    const t = tableRef(schema, "documents");
    const taken = await takenInSeries(client, t, series, exceptId);
    return formatSeriesNumber(series, nextFreeLiveDisplay(taken, series));
  });
}

// ---- the handler factory ----

export function createDataApi(schema: AppSchema) {
  async function handle(req: NextRequest, pathParts: string[]): Promise<Response> {
    const [a, b, c] = pathParts;
    const method = req.method;

    // ---------- auth (no session required) ----------
    if (a === "auth") {
      if (b === "login" && method === "POST") {
        const body = (await req.json().catch(() => ({}))) as AnyRec;
        const user = await checkLogin(schema, String(body.userId || ""), String(body.password || ""));
        if (!user) return err(401, "Wrong password");
        await writeActivity(schema, {
          by: user.id,
          byName: user.name,
          action: "login",
          summary: user.name + " signed in",
        });
        return json({ user }, 200, { "Set-Cookie": sessionCookie(makeSessionToken(user)) });
      }
      if (b === "logout" && method === "POST") {
        const u = userFrom(req);
        if (u) {
          await writeActivity(schema, {
            by: u.id,
            byName: u.name,
            action: "logout",
            summary: u.name + " signed out",
          });
        }
        return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
      }
      if (b === "me" && method === "GET") return json({ user: userFrom(req) });
      if (b === "password" && method === "POST") {
        const user = userFrom(req);
        if (!user) return err(401, "Not signed in");
        const body = (await req.json().catch(() => ({}))) as AnyRec;
        const pw = String(body.password || "").trim();
        if (pw.length < 4) return err(400, "Password too short");
        await changeUserPassword(schema, user.id, pw);
        return json({ ok: true });
      }
      return err(404, "Unknown auth route");
    }

    // ---------- everything below requires a session ----------
    const user = userFrom(req);
    if (!user) return err(401, "Not signed in");

    if (a === "bootstrap" && method === "GET") {
      const out: AnyRec = {};
      for (const table of SYNC_TABLES) {
        const rows = await listRows(schema, table);
        if (table === "documents") {
          Object.assign(out, splitDocs(rows));
        } else {
          out[TABLE_STORE[table]] = rows.map((r) => r.data);
        }
      }
      const meta = await metaGetAll(schema);
      const nowRow = await sql<{ now: string }>("select now()::text as now");
      return json({ user, stores: out, meta, now: nowRow[0].now });
    }

    if (a === "changes" && method === "GET") {
      const since = req.nextUrl.searchParams.get("since") || "1970-01-01";
      const changes: AnyRec = {};
      for (const table of SYNC_TABLES) {
        const rows = await changedRows(schema, table, since);
        if (!rows.length) continue;
        const mapped = rows.map((r) => ({
          id: r.id,
          deleted: !!r.deleted_at,
          data: r.data,
        }));
        if (table === "documents") {
          const qs = mapped.filter((m) => (m.data as AnyRec).kind !== "invoice");
          const inv = mapped.filter((m) => (m.data as AnyRec).kind === "invoice");
          if (qs.length) changes.quotations = qs;
          if (inv.length) changes.invoices = inv;
        } else {
          changes[TABLE_STORE[table]] = mapped;
        }
      }
      const meta = await metaGetAll(schema); // small — send whole map every poll
      const nowRow = await sql<{ now: string }>("select now()::text as now");
      return json({ changes, meta, now: nowRow[0].now });
    }

    if (a === "rec") {
      const table = STORE_TABLE[b];
      if (!table) return err(404, "Unknown store: " + b);
      const id = decodeURIComponent(c || "");
      if (!id) return err(400, "Missing id");
      // never audit the audit trail itself
      const auditStore = b !== "activity" && table !== "activity";
      if (method === "PUT") {
        const data = (await req.json().catch(() => null)) as AnyRec | null;
        if (!data || typeof data !== "object") return err(400, "Bad record");
        const prev = await getRow(schema, table, id);
        const row = await upsertRow(schema, table, id, data);
        if (auditStore && (!prev || prev.deleted_at)) {
          await writeActivity(schema, {
            by: user.id,
            byName: user.name,
            action: "create",
            store: b,
            targetId: id,
            summary: "Created " + recordSummary(b, data, id),
          });
        }
        return json({ data: row.data, updatedAt: row.updated_at });
      }
      if (method === "DELETE") {
        const prev = auditStore ? await getRow(schema, table, id) : undefined;
        await softDeleteRow(schema, table, id);
        if (auditStore && prev && !prev.deleted_at) {
          await writeActivity(schema, {
            by: user.id,
            byName: user.name,
            action: "delete",
            store: b,
            targetId: id,
            summary: "Deleted " + recordSummary(b, prev.data as AnyRec, id),
          });
        }
        return json({ ok: true });
      }
      if (method === "GET") {
        const row = await getRow(schema, table, id);
        if (!row || row.deleted_at) return err(404, "Not found");
        return json({ data: row.data });
      }
      return err(405, "Method not allowed");
    }

    if (a === "meta" && b && method === "PUT") {
      const body = (await req.json().catch(() => ({}))) as AnyRec;
      await metaSet(schema, decodeURIComponent(b), body.v);
      return json({ ok: true });
    }

    // ---------- unified all-transactions (all money entries) ----------
    if (a === "all-transactions" && method === "GET") {
      const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "500", 10), 2000);
      const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);
      const typeFilter = req.nextUrl.searchParams.get("type") || "";

      // Helper: parse "dd-mm-yy" → ISO string
      const dmyToIso = (s: string) => {
        if (!s) return "";
        const [d, m, y] = s.split("-");
        if (!d || !m) return "";
        const yy = y ? (y.length === 2 ? "20" + y : y) : "2026";
        return `${yy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      };

      // Expenses (receipts and costs)
      const expenseRows = await sql<Row>(
        `select * from ${tableRef(schema, "expenses")} where data->>'sourceId' is null or data->>'sourceId' = '' or data->>'sourceId' not like 'wkr:%' order by created_at desc limit ${Math.min(limit + 200, 3000)}`,
      );
      const expenses = expenseRows.map((r) => ({ r, e: r.data as AnyRec }));

      // Session handovers
      const sessionRows = await sql<Row>(
        `select * from ${tableRef(schema, "sessions")} where data->>'handover' = 'true' order by created_at desc limit ${Math.min(limit + 100, 2000)}`,
      );

      // Load lookups
      const [customers, suppliers, workers, payHolders] = await Promise.all([
        sql<Row>(`select * from ${tableRef(schema, "customers")}`),
        sql<Row>(`select * from ${tableRef(schema, "suppliers")}`),
        sql<Row>(`select * from ${tableRef(schema, "workers")}`),
        sql<Row>(`select * from ${tableRef(schema, "pay_holders")}`),
      ]);
      const custMap = new Map(customers.map((r) => [r.id, (r.data as AnyRec).name as string]));
      const suppMap = new Map(suppliers.map((r) => [r.id, (r.data as AnyRec).name as string]));
      const wrkMap = new Map(workers.map((r) => [r.id, (r.data as AnyRec).name as string]));
      const phMap = new Map(payHolders.map((r) => [r.id, (r.data as AnyRec).name as string]));

      interface UnifiedTx {
        id: string; date: string; type: string; amount: number;
        party: string; partyType: string; mode: string; note: string;
        enteredBy: string; deleted: boolean; createdAt: string;
        sourceId?: string;
      }

      const all: UnifiedTx[] = [];

      for (const { r, e } of expenses) {
        const amount = Math.round(+(e.amount || 0) * 100) / 100;
        if (!amount) continue;
        const charge = e.charge as string;
        const mode = String(e.mode || e.label || "");
        const isCharge = !!charge;
        let type = "expense";
        let party = "";
        let partyType = "";
        if (isCharge) {
          type = "receipt_charge";
          party = custMap.get(String(e.customerId || "")) || "";
          partyType = "Customer";
          if (!party) party = String(e.account || "");
        } else if (mode === "salary") {
          type = "salary";
          party = wrkMap.get(String(e.workerId || e.accountId || "")) || String(e.account || "");
          partyType = "Worker";
        } else if (e.accountId) {
          const ph = phMap.get(String(e.accountId));
          if (ph) { party = ph; partyType = "Holder"; }
        }
        // Determine inflow/outflow
        if (!isCharge && (mode === "cash" || mode === "upi" || mode === "cheque")) type = "receipt";

        all.push({
          id: r.id, date: String(e.date || ""), type, amount: Math.abs(amount),
          party: party || String(e.label || e.note || ""),
          partyType, mode, note: String(e.note || ""),
          enteredBy: String(e.enteredBy || ""),
          deleted: !!r.deleted_at,
          createdAt: String(r.created_at || ""),
          sourceId: (e.sourceId as string) || undefined,
        });
      }

      // Session handovers
      for (const r of sessionRows) {
        const s = r.data as AnyRec;
        const cash = Math.round(+(s.cashTotal || 0) * 100) / 100;
        const upi = Math.round(+(s.upiTotal || 0) * 100) / 100;
        const total = cash + upi;
        if (!total) continue;
        all.push({
          id: r.id, date: String(s.date || ""), type: "session_handover",
          amount: total, party: String(s.by || ""), partyType: "Session",
          mode: cash && upi ? "Cash+UPI" : cash ? "Cash" : "UPI",
          note: s.pending ? "Pending owner confirmation" : "Confirmed",
          enteredBy: String(s.by || ""), deleted: !!r.deleted_at,
          createdAt: String(r.created_at || ""),
        });
      }

      const typeLabels: Record<string, string> = {
        expense: "expense", receipt: "receipt", salary: "salary",
        session_handover: "session_handover", receipt_charge: "receipt_charge",
      };

      let filtered = all;
      if (typeFilter && typeLabels[typeFilter]) {
        filtered = all.filter((t) => t.type === typeFilter);
      }
      filtered.sort((a, b) => {
        const da = dmyToIso(a.date);
        const db = dmyToIso(b.date);
        if (da !== db) return (db || "").localeCompare(da || "");
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);
      return json({ transactions: page, total, limit, offset });
    }

    if (a === "rpc" && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as AnyRec;
      if (b === "create-doc") {
        const data = body.data as AnyRec;
        if (!data || typeof data !== "object") return err(400, "Bad document");
        const doc = await createDocAtomic(schema, data);
        const store = doc.kind === "invoice" ? "invoices" : "quotations";
        await writeActivity(schema, {
          by: user.id,
          byName: user.name,
          action: "create",
          store,
          targetId: String(doc.id || ""),
          summary: "Created " + recordSummary(store, doc, String(doc.id || "")),
        });
        return json({ data: doc });
      }
      if (b === "next-voucher-no") {
        const type = String(body.type || "Journal").replace(/[^a-zA-Z]/g, "");
        const n = await nextCounter(schema, "vno_" + type);
        return json({ n });
      }
      if (b === "next-invoice-number") {
        const s = String(body.series || "sell");
        const series: InvoiceSeries = s === "buy" ? "buy" : s === "rent" ? "rent" : "sell";
        const exceptId = body.exceptId ? String(body.exceptId) : undefined;
        return json({ number: await nextNumberAtomic(schema, series, exceptId) });
      }
      return err(404, "Unknown rpc");
    }

    return err(404, "Unknown route");
  }

  return {
    async request(req: NextRequest, params: Promise<{ path?: string[] }>): Promise<Response> {
      try {
        const { path } = await params;
        return await handle(req, path || []);
      } catch (e) {
        console.error("[data-api]", e);
        return err(500, e instanceof Error ? e.message : "Server error");
      }
    },
  };
}
