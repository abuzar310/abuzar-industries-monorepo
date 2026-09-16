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
  ensureChatTable,
  ensureCarpentersTable,
  ensurePurchaseSheetsTable,
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

/** Never send the AI API key to any browser. */
function clientMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out = { ...meta };
  const key = typeof out.aiApiKey === "string" ? out.aiApiKey.trim() : "";
  delete out.aiApiKey;
  out.aiConfigured = !!key;
  return out;
}

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

type ActAction = "login" | "logout" | "create" | "update" | "delete";

/** Append one owner-visible audit row. Never throws. */
async function writeActivity(
  schema: AppSchema,
  opts: {
    by: string;
    byName: string;
    role?: string;
    action: ActAction;
    store?: string;
    targetId?: string;
    summary: string;
    detail?: string;
    amount?: number;
    mode?: string;
    date?: string;
    party?: string;
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
      role: opts.role || "",
      action: opts.action,
      store: opts.store || "",
      targetId: opts.targetId || "",
      summary: opts.summary,
      detail: opts.detail || "",
      amount: opts.amount ?? null,
      mode: opts.mode || "",
      date: opts.date || "",
      party: opts.party || "",
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
    expenses: "expense / receipt",
    sessions: "daybook session",
    stock: "stock",
    workers: "worker",
    attendance: "attendance day",
    ledgers: "ledger",
    vouchers: "voucher",
    collections: "collection",
    payHolders: "pay holder",
    pay_holders: "pay holder",
    purchases: "purchase buy",
    carpenters: "carpenter",
    purchaseSheets: "purchase sheet",
    purchase_sheets: "purchase sheet",
  };
  return m[store] || store;
}

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return "₹" + (Math.round(v * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Rich snapshot lines for the Logs detail panel. */
function recordDetail(store: string, data: AnyRec | null | undefined, id: string): {
  summary: string;
  detail: string;
  amount?: number;
  mode?: string;
  date?: string;
  party?: string;
} {
  if (!data) {
    return { summary: storeLabel(store) + " " + id, detail: "id " + id };
  }
  const kind = storeLabel(store);
  const num = String(data.displayNumber || data.number || "");
  const party = String(data.customerName || data.name || data.label || "").trim();
  const note = String(data.note || "").trim();
  const date = String(data.date || "").trim();
  const mode = data.mode ? String(data.mode) : data.toOwner ? "owner-cash" : "";
  const type = data.type ? String(data.type) : data.kind ? String(data.kind) : "";
  const status = data.status ? String(data.status) : data.paymentStatus ? String(data.paymentStatus) : "";
  const amount = data.amount != null ? Number(data.amount) : data.amountPaid != null ? Number(data.amountPaid) : undefined;
  const phone = data.phone ? String(data.phone) : "";
  const account = data.account ? String(data.account) : "";
  const lines: string[] = [];
  lines.push("Record: " + kind + (num ? " #" + num : "") + " · id " + id);
  if (party) lines.push("Party / name: " + party);
  if (phone) lines.push("Phone: " + phone);
  if (type) lines.push("Type: " + type);
  if (status) lines.push("Status: " + status);
  if (amount != null && Number.isFinite(amount)) lines.push("Amount: " + money(amount));
  if (data.payCash != null || data.payUpi != null) {
    lines.push(
      "Paid: cash " + money(data.payCash || 0) + " · bank/UPI " + money(data.payUpi || 0) +
        (data.amountPaid != null ? " · total " + money(data.amountPaid) : ""),
    );
  }
  if (mode) lines.push("Mode: " + mode + (data.toOwner ? " (to owner)" : ""));
  if (account) lines.push("Account: " + account);
  if (date) lines.push("Business date: " + date);
  if (note) lines.push("Note: " + note);
  if (data.charge) lines.push("Flag: due/charge (increases balance)");
  if (data.custId) lines.push("Customer id: " + String(data.custId));
  if (data.sourceId) lines.push("Linked to: " + String(data.sourceId));
  if (data.rcptId) lines.push("Receipt group: " + String(data.rcptId));
  if (data.enteredBy) lines.push("Entered by (field): " + String(data.enteredBy));
  const summary = [kind, num && ("#" + num), party, amount != null ? money(amount) : ""].filter(Boolean).join(" · ") || kind + " " + id;
  return { summary, detail: lines.join("\n"), amount, mode, date, party };
}

function fieldDiffs(prev: AnyRec, next: AnyRec): string {
  const keys = [
    "customerName", "name", "label", "note", "amount", "mode", "account", "date", "status",
    "paymentStatus", "payCash", "payUpi", "amountPaid", "phone", "type", "toOwner", "charge",
    "number", "displayNumber", "finalPrice",
  ];
  const out: string[] = [];
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if (a === b) continue;
    if (a == null && (b === "" || b === 0 || b === false)) continue;
    if (b == null && (a === "" || a === 0 || a === false)) continue;
    const fmt = (v: unknown) =>
      typeof v === "number" ? money(v) : v === true ? "yes" : v === false ? "no" : v == null ? "—" : String(v);
    out.push(k + ": " + fmt(a) + " → " + fmt(b));
  }
  return out.join("\n");
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
          role: user.role,
          action: "login",
          summary: user.name + " (" + user.role + ") signed in",
          detail:
            "User: " + user.name + "\nRole: " + user.role + "\nUser id: " + user.id + "\nAction: login (session cookie set)",
        });
        return json({ user }, 200, { "Set-Cookie": sessionCookie(makeSessionToken(user)) });
      }
      if (b === "logout" && method === "POST") {
        const u = userFrom(req);
        if (u) {
          await writeActivity(schema, {
            by: u.id,
            byName: u.name,
            role: u.role,
            action: "logout",
            summary: u.name + " (" + u.role + ") signed out",
            detail:
              "User: " + u.name + "\nRole: " + u.role + "\nUser id: " + u.id + "\nAction: logout (session cleared)",
          });
        }
        return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
      }
      if (b === "me" && method === "GET") return json({ user: userFrom(req) });
      if (b === "password" && method === "POST") {
        const user = userFrom(req);
        if (!user) return err(401, "Not signed in");
        // managers cannot change passwords — owner only
        if (user.role !== "owner") return err(403, "Only the owner can change passwords");
        const body = (await req.json().catch(() => ({}))) as AnyRec;
        const pw = String(body.password || "").trim();
        if (pw.length < 4) return err(400, "Password too short");
        await changeUserPassword(schema, user.id, pw);
        await writeActivity(schema, {
          by: user.id,
          byName: user.name,
          role: user.role,
          action: "update",
          store: "users",
          targetId: user.id,
          summary: user.name + " changed their password",
          detail: "Password updated for " + user.name + " (" + user.id + ")",
        });
        return json({ ok: true });
      }
      return err(404, "Unknown auth route");
    }

    // ---------- everything below requires a session ----------
    const user = userFrom(req);
    if (!user) return err(401, "Not signed in");
    await ensureChatTable(schema);
    await ensureCarpentersTable(schema);
    await ensurePurchaseSheetsTable(schema);

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
      const meta = clientMeta(await metaGetAll(schema));
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
      const meta = clientMeta(await metaGetAll(schema)); // small — send whole map every poll (key stripped)
      const nowRow = await sql<{ now: string }>("select now()::text as now");
      return json({ changes, meta, now: nowRow[0].now });
    }

    if (a === "rec") {
      const table = STORE_TABLE[b];
      if (!table) return err(404, "Unknown store: " + b);
      const id = decodeURIComponent(c || "");
      if (!id) return err(400, "Missing id");
      // never audit the audit trail itself
      const auditStore = b !== "activity" && table !== "activity" && b !== "chat";
      if (method === "PUT") {
        const data = (await req.json().catch(() => null)) as AnyRec | null;
        if (!data || typeof data !== "object") return err(400, "Bad record");
        const prev = await getRow(schema, table, id);
        const row = await upsertRow(schema, table, id, data);
        if (auditStore) {
          const snap = recordDetail(b, data, id);
          if (!prev || prev.deleted_at) {
            await writeActivity(schema, {
              by: user.id,
              byName: user.name,
              role: user.role,
              action: "create",
              store: b,
              targetId: id,
              summary: "Created · " + snap.summary,
              detail: snap.detail + "\nBy: " + user.name + " (" + user.role + ")",
              amount: snap.amount,
              mode: snap.mode,
              date: snap.date,
              party: snap.party,
            });
          } else {
            const diffs = fieldDiffs(prev.data as AnyRec, data);
            if (diffs) {
              await writeActivity(schema, {
                by: user.id,
                byName: user.name,
                role: user.role,
                action: "update",
                store: b,
                targetId: id,
                summary: "Updated · " + snap.summary,
                detail:
                  snap.detail +
                  "\n\nChanges:\n" +
                  diffs +
                  "\n\nBy: " +
                  user.name +
                  " (" +
                  user.role +
                  ")",
                amount: snap.amount,
                mode: snap.mode,
                date: snap.date,
                party: snap.party,
              });
            }
          }
        }
        return json({ data: row.data, updatedAt: row.updated_at });
      }
      if (method === "DELETE") {
        const prev = auditStore ? await getRow(schema, table, id) : undefined;
        await softDeleteRow(schema, table, id);
        if (auditStore && prev && !prev.deleted_at) {
          const snap = recordDetail(b, prev.data as AnyRec, id);
          await writeActivity(schema, {
            by: user.id,
            byName: user.name,
            role: user.role,
            action: "delete",
            store: b,
            targetId: id,
            summary: "Deleted · " + snap.summary,
            detail: snap.detail + "\nBy: " + user.name + " (" + user.role + ")\nSoft-deleted (recoverable in DB)",
            amount: snap.amount,
            mode: snap.mode,
            date: snap.date,
            party: snap.party,
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
      const mk = decodeURIComponent(b);
      if (mk === "aiApiKey" || mk === "aiHost" || mk === "aiModel") return err(403, "Set AI in Settings");
      const body = (await req.json().catch(() => ({}))) as AnyRec;
      await metaSet(schema, mk, body.v);
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
        sourceId?: string; custId?: string; carpenterId?: string;
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
          createdAt: String(e.createdAt || r.created_at || ""),
          sourceId: (e.sourceId as string) || undefined,
          custId: (e.custId as string) || undefined,
          carpenterId: (e.carpenterId as string) || undefined,
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
        const snap = recordDetail(store, doc, String(doc.id || ""));
        await writeActivity(schema, {
          by: user.id,
          byName: user.name,
          role: user.role,
          action: "create",
          store,
          targetId: String(doc.id || ""),
          summary: "Created · " + snap.summary,
          detail: snap.detail + "\nBy: " + user.name + " (" + user.role + ")",
          amount: snap.amount,
          mode: snap.mode,
          date: snap.date,
          party: snap.party,
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
