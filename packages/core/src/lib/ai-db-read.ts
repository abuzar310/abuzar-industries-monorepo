// READ-ONLY yard snapshot for AI. Uses SELECT helpers only — never upsert/delete/metaSet.
import { getRow, listRows, type AppSchema, type Row } from "@/server/db";
import { customerFinancials } from "./customers";
import { partyLedger, quoteBill } from "./payments";
import type { Customer, Doc, Expense, Stock, Supplier } from "./types";

const rs = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

const STOP = new Set(
  "who whom whose what which where when why how the a an and or to of in on for from with our us we they them i you alot lot most much still due dues owe owes owing pending balance balances customer customers party parties quote quotes quotation quotations invoice invoices show list tell give please now right today".split(
    " ",
  ),
);

function rec<T>(row: Row): T {
  const d = { ...(row.data || {}) } as T & { id?: string };
  if (d && typeof d === "object" && !("id" in d && d.id)) d.id = row.id;
  return d as T;
}

function tokens(q: string): string[] {
  return (q || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function nameHit(name: string, toks: string[]): boolean {
  const n = (name || "").toLowerCase();
  return !!n && toks.some((t) => n.includes(t));
}

async function loadCustomers(schema: AppSchema): Promise<Customer[]> {
  const rows = await listRows(schema, "customers");
  return rows.map((r) => rec<Customer>(r));
}

async function loadDocs(schema: AppSchema): Promise<{ quotes: Doc[]; invoices: Doc[] }> {
  const rows = await listRows(schema, "documents");
  const quotes: Doc[] = [];
  const invoices: Doc[] = [];
  for (const r of rows) {
    const d = rec<Doc>(r);
    if (d.deletedAt || d.purgedAt) continue;
    if (d.kind === "invoice") invoices.push(d);
    else quotes.push(d);
  }
  return { quotes, invoices };
}

async function loadExpenses(schema: AppSchema): Promise<Expense[]> {
  const rows = await listRows(schema, "expenses");
  return rows.map((r) => rec<Expense>(r));
}

/** Build a capped read-only snapshot. Never writes. */
export async function readAiDbSnapshot(opts: {
  schema: AppSchema;
  pathname?: string;
  docId?: string;
  question?: string;
  cloak?: boolean;
}): Promise<string> {
  if (opts.cloak) {
    return "READ-ONLY DB. Money is cloaked for this user — do not invent rupee amounts. Guide with tab names only.";
  }

  const schema = opts.schema;
  const unofficial = schema === "unofficial";
  const path = (opts.pathname || "/").split("?")[0];
  const qtext = opts.question || "";
  const toks = tokens(qtext);
  const lines: string[] = [
    "READ-ONLY DATABASE SNAPSHOT (" +
      schema +
      "). You may use these figures. You CANNOT change the books. Do not say you lack access.",
  ];

  try {
    const [customers, docs, expenses] = await Promise.all([
      loadCustomers(schema),
      loadDocs(schema),
      unofficial ? loadExpenses(schema) : Promise.resolve([] as Expense[]),
    ]);
    const { quotes, invoices } = docs;

    if (unofficial) {
      const ledger = partyLedger(quotes, expenses, customers);
      const owing = ledger.parties.filter((p) => p.balance > 0.5);
      const top = owing.slice(0, 15);
      lines.push(
        "Cut Size dues (same as Balances). Total pending " +
          rs(ledger.totalPending) +
          " · " +
          owing.length +
          " parties.",
      );
      if (top.length) {
        lines.push("Who owes most:\n" + top.map((p, i) => i + 1 + ". " + (p.name || "—") + " — " + rs(p.balance)).join("\n"));
      } else {
        lines.push("Nobody currently has an outstanding balance.");
      }

      const named = toks.length
        ? ledger.parties.filter((p) => nameHit(p.name, toks)).slice(0, 3)
        : [];
      for (const p of named) {
        const qlist = p.quotes
          .filter((x) => x.balance > 0.5)
          .slice(0, 8)
          .map((x) => x.number + " due " + rs(x.balance))
          .join("; ");
        lines.push(
          "Match “" +
            p.name +
            "”: billed " +
            rs(p.billed) +
            ", paid " +
            rs(p.paid) +
            ", due " +
            rs(p.balance) +
            (qlist ? ". Open quotes: " + qlist : ""),
        );
      }
    } else {
      const rows = customers
        .map((c) => ({
          c,
          f: customerFinancials(c.id, quotes, invoices, +(c.opening || 0), [], false),
        }))
        .filter((x) => x.f.outstanding > 0.5)
        .sort((a, b) => b.f.outstanding - a.f.outstanding);
      const top = rows.slice(0, 15);
      const total = rows.reduce((s, x) => s + x.f.outstanding, 0);
      lines.push(
        "Official invoice dues (quotations are estimates, invoices are bills). Total outstanding " +
          rs(total) +
          " · " +
          rows.length +
          " customers.",
      );
      if (top.length) {
        lines.push(
          "Who owes most:\n" +
            top.map((x, i) => i + 1 + ". " + (x.c.name || "—") + " — " + rs(x.f.outstanding)).join("\n"),
        );
      } else {
        lines.push("No customer invoice outstanding right now.");
      }

      const named = toks.length ? rows.filter((x) => nameHit(x.c.name, toks)).slice(0, 3) : [];
      for (const x of named) {
        const openInv = invoices
          .filter((d) => d.customerId === x.c.id && !d.deletedAt)
          .map((d) => {
            const bill = quoteBill(d);
            const paid = +d.amountPaid || 0;
            return { no: d.number, due: bill - paid };
          })
          .filter((d) => d.due > 0.5)
          .slice(0, 8);
        lines.push(
          "Match “" +
            x.c.name +
            "”: billed " +
            rs(x.f.billed) +
            ", paid " +
            rs(x.f.paid) +
            ", due " +
            rs(x.f.outstanding) +
            (openInv.length
              ? ". Invoices: " + openInv.map((d) => d.no + " due " + rs(d.due)).join("; ")
              : ""),
        );
      }

      lines.push("Live quotations: " + quotes.length + " · live invoices: " + invoices.length);

      try {
        const stockRows = await listRows(schema, "stock");
        const stock = stockRows
          .map((r) => rec<Stock>(r))
          .filter((s) => (s.cft || 0) >= 0)
          .sort((a, b) => (a.cft || 0) - (b.cft || 0));
        const low = stock.filter((s) => (s.cft || 0) < 50).slice(0, 8);
        if (stock.length) {
          lines.push(
            "Stock rows: " +
              stock.length +
              (low.length
                ? ". Lowest CFT: " + low.map((s) => (s.name || s.key) + " " + (s.cft || 0).toFixed(1)).join("; ")
                : ""),
          );
        }
      } catch {
        /* stock table may be empty */
      }

      try {
        const supRows = await listRows(schema, "suppliers");
        const sups = supRows.map((r) => rec<Supplier>(r));
        if (sups.length) lines.push("Suppliers on file: " + sups.length + " (names not expanded).");
      } catch {
        /* ignore */
      }
    }

    const docId = (opts.docId || "").trim();
    const fromPath = path.match(/^\/editor\/([^/]+)/);
    const id = docId || (fromPath ? decodeURIComponent(fromPath[1]) : "");
    if (id && !id.startsWith("temp_")) {
      const row = await getRow(schema, "documents", id);
      if (row && !row.deleted_at) {
        const d = rec<Doc>(row);
        const bill = quoteBill(d);
        const paid = +d.amountPaid || 0;
        lines.push(
          "Open document: " +
            (d.kind === "invoice" ? "Invoice " : "Quotation ") +
            (d.number || id) +
            " · " +
            (d.customerName || "—") +
            " · bill " +
            rs(bill) +
            " · paid " +
            rs(paid) +
            " · due " +
            rs(Math.max(0, bill - paid)) +
            " · status " +
            (d.status || "—"),
        );
      }
    }

    const custM = path.match(/^\/customers\/([^/]+)/);
    if (custM) {
      const cid = decodeURIComponent(custM[1]);
      const row = await getRow(schema, "customers", cid);
      if (row && !row.deleted_at) {
        const c = rec<Customer>(row);
        lines.push("Open customer record: " + (c.name || cid) + (c.site ? " · site " + c.site : ""));
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db read failed";
    lines.push("DB snapshot failed (" + msg.slice(0, 120) + "). Do not invent amounts.");
  }

  return lines.join("\n").slice(0, 3500);
}
