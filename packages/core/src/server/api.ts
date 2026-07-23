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

// ---- All Transactions (unified dashboard view) ----

async function allTransactions(schema: AppSchema): Promise<AnyRec[]> {
  // All expenses including soft-deleted — the full financial history
  const rows = await sql<Row>(
    `select * from ${tableRef(schema, "expenses")} order by created_at desc limit 2000`,
  );
  return rows.map((r) => ({
    _table: "expenses",
    _deleted: !!r.deleted_at,
    _createdAt: r.created_at,
    _updatedAt: r.updated_at,
    ...(r.data as AnyRec),
  }));
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
        return json({ user }, 200, { "Set-Cookie": sessionCookie(makeSessionToken(user)) });
      }
      if (b === "logout" && method === "POST")
        return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
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
      if (method === "PUT") {
        const data = (await req.json().catch(() => null)) as AnyRec | null;
        if (!data || typeof data !== "object") return err(400, "Bad record");
        const row = await (await import("./db")).upsertRow(schema, table, id, data);
        return json({ data: row.data, updatedAt: row.updated_at });
      }
      if (method === "DELETE") {
        await softDeleteRow(schema, table, id);
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

    if (a === "rpc" && method === "POST") {
      const body = (await req.json().catch(() => ({}))) as AnyRec;
      if (b === "create-doc") {
        const data = body.data as AnyRec;
        if (!data || typeof data !== "object") return err(400, "Bad document");
        const doc = await createDocAtomic(schema, data);
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

    // ---------- unified all-transactions (union of all money entries, incl. deleted) ----------
    if (a === "all-transactions" && method === "GET") {
      const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "500", 10), 2000);
      const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);
      const typeFilter = req.nextUrl.searchParams.get("type") || ""; // empty = all
      const dateFrom = req.nextUrl.searchParams.get("from") || ""; // dd-mm-yy
      const dateTo = req.nextUrl.searchParams.get("to") || "";

      // Helper to parse dd-mm-yy → ISO prefix for ordering
      const dmyToIso = (dmy: string): string => {
        const [dd = "", mm = "", yy = ""] = dmy.split("-");
        return dd && mm && yy ? `20${yy}-${mm}-${dd}` : "";
      };
      const fromIso = dateFrom ? dmyToIso(dateFrom) : "";
      const toIso = dateTo ? dmyToIso(dateTo) + " 23:59:59" : "";

      type UnifiedTx = {
        id: string;
        type: "expense" | "receipt" | "session" | "session_handover" | "payment" | "advance" | "deduction" | "repayment";
        date: string; // dd-mm-yy
        amount: number;
        party: string; // customer / supplier / worker / account
        partyType: "customer" | "supplier" | "worker" | "account" | "";
        mode: string; // cash, upi, ""
        note: string;
        enteredBy: string;
        deleted: boolean;
        createdAt: string;
        sourceId?: string;
        sourceType?: string;
      };

      // 1. expenses (daybook) - all types including deleted
      const expRows = await sql<Row>(
        `select * from ${tableRef(schema, "expenses")} order by created_at desc limit $1 offset $2`,
        [limit * 3, offset], // fetch more to filter later
      );

      // 2. sessions (daybook handovers) - include pending/confirmed
      const sessRows = await sql<Row>(
        `select * from ${tableRef(schema, "sessions")} order by created_at desc limit $1 offset $2`,
        [100, 0],
      );

      // 3. attendance payments (wage, advance, deduction, repayment)
      const attRows = await sql<Row>(
        `select * from ${tableRef(schema, "attendance")} order by created_at desc limit $1 offset $2`,
        [200, 0],
      );

      // Load lookups
      const [customers, suppliers, workers, payHolders] = await Promise.all([
        sql<Row>(`select id, name from ${tableRef(schema, "customers")}`),
        sql<Row>(`select id, name from ${tableRef(schema, "suppliers")}`),
        sql<Row>(`select id, name from ${tableRef(schema, "workers")}`),
        sql<Row>(`select id, name from ${tableRef(schema, "pay_holders")}`),
      ]);
      const custMap = new Map(customers.rows.map((r) => [r.id, r.data.name as string]));
      const suppMap = new Map(suppliers.rows.map((r) => [r.id, r.data.name as string]));
      const workMap = new Map(workers.rows.map((r) => [r.id, r.data.name as string]));
      const phMap = new Map(payHolders.rows.map((r) => [r.id, r.data.name as string]));

      const all: UnifiedTx[] = [];

      // Expenses / Daybook entries
      for (const r of expRows.rows) {
        const e = r.data as AnyRec;
        const dmy = e.date || "";
        const iso = dmyToIso(dmy);
        if (fromIso && iso < fromIso) continue;
        if (toIso && iso > toIso.replace(" 23:59:59", "")) continue;
        if (typeFilter && e.type !== typeFilter) continue;

        let party = "";
        let partyType: UnifiedTx["partyType"] = "";
        if (e.custId) { party = custMap.get(e.custId) || e.custId; partyType = "customer"; }
        else if ((e.data as AnyRec)?.supplierId) { party = suppMap.get(e.supplierId) || e.supplierId; partyType = "supplier"; }
        else if (e.account) { party = e.account; partyType = "account"; }

        all.push({
          id: r.id,
          type: e.type === "sale" && e.custId ? "receipt" : e.type as UnifiedTx["type"],
          date: dmy,
          amount: +e.amount || 0,
          party,
          partyType,
          mode: e.mode || "",
          note: e.note || e.label || "",
          enteredBy: e.enteredBy || "",
          deleted: !!r.deleted_at,
          createdAt: r.created_at,
          sourceId: e.sourceId,
          sourceType: e.charge ? "due" : "payment",
        });
      }

      // Session handovers
      for (const r of sessRows.rows) {
        const s = r.data as AnyRec;
        const dmy = s.date || "";
        const iso = dmyToIso(dmy);
        if (fromIso && iso < fromIso) continue;
        if (toIso && iso > toIso.replace(" 23:59:59", "")) continue;
        if (typeFilter && typeFilter !== "session") continue;

        all.push({
          id: r.id,
          type: "session_handover",
          date: dmy,
          amount: +s.given || 0,
          party: `Session → ${phMap.get(s.by) || s.by}`,
          partyType: "account",
          mode: "cash",
          note: s.pending ? "Pending owner confirmation" : "Confirmed",
          enteredBy: s.by || "",
          deleted: !!r.deleted_at,
          createdAt: r.created_at,
        });
      }

      // Attendance money (wage payments, advances, deductions, repayments)
      const expenseRows = await sql<Row>(
        `select * from ${tableRef(schema, "expenses")} where sourceId like 'wkr:%' or sourceId like 'wkradv:%' or sourceId like 'wkrded:%' order by created_at desc limit 300`,
      );
      const workerExpenses = expenseRows.rows.map((r) => r.data as AnyRec);

      for (const e of workerExpenses) {
        const dmy = e.date || "";
        const iso = dmyToIso(dmy);
        if (fromIso && iso < fromIso) continue;
        if (toIso && iso > toIso.replace(" 23:59:59", "")) continue;
        if (typeFilter) {
          const src = e.sourceId || "";
          const map: Record<string, string> = { "wkr:": "payment", "wkradv:": "advance", "wkrded:": "deduction" };
          const matched = Object.entries(map).find(([k]) => src.startsWith(k));
          if (matched && matched[1] !== typeFilter) continue;
        }

        const workerId = e.sourceId?.split(":")[1] || "";
        const party = workMap.get(workerId) || workerId;

        all.push({
          id: e.id,
          type: e.sourceId?.startsWith("wkr:") ? "payment" : e.sourceId?.startsWith("wkradv:") ? "advance" : "deduction",
          date: dmy,
          amount: +e.amount || 0,
          party,
          partyType: "worker",
          mode: e.mode || "cash",
          note: e.note || e.label || "",
          enteredBy: e.enteredBy || "",
          deleted: e.charge || false, // charge = deduction (no cash), show as deleted-like
          createdAt: e.createdAt || e.updatedAt || "",
          sourceId: e.sourceId,
        });
      }

      // Repayments (sale type with wkr: sourceId)
      for (const e of workerExpenses) {
        if (e.type !== "sale" || !e.sourceId?.startsWith("wkr:")) continue;
        const dmy = e.date || "";
        const iso = dmyToIso(dmy);
        if (fromIso && iso < fromIso) continue;
        if (toIso && iso > toIso.replace(" 23:59:59", "")) continue;
        if (typeFilter && typeFilter !== "repayment") continue;

        const workerId = e.sourceId.split(":")[1] || "";
        const party = workMap.get(workerId) || workerId;

        all.push({
          id: e.id,
          type: "repayment",
          date: dmy,
          amount: +e.amount || 0,
          party,
          partyType: "worker",
          mode: e.mode || "cash",
          note: e.note || e.label || "",
          enteredBy: e.enteredBy || "",
          deleted: false,
          createdAt: e.createdAt || e.updatedAt || "",
          sourceId: e.sourceId,
        });
      }

      // Sort by date desc, then createdAt desc
      all.sort((a, b) => {
        const da = dmyToIso(a.date);
        const db = dmyToIso(b.date);
        if (da !== db) return db.localeCompare(da);
        return b.createdAt.localeCompare(a.createdAt);
      });

      const total = all.length;
      const page = all.slice(0, limit);

      return json({ transactions: page, total, limit, offset });
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
