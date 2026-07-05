import { computeDoc } from "./calc";
import type { Customer, Doc, Expense, PayMode } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** the effective bill of a quote: the accepted round-figure override, else the computed grand total. */
export const quoteBill = (d: Doc) => (d.finalPrice && d.finalPrice > 0 ? d.finalPrice : computeDoc(d).grand);

/** One payment line under a party — the "statement" (to which account, when, by whom, how). */
export interface PartyStatement {
  id: string;
  amount: number;
  mode: PayMode; // "cash" | "upi"
  account: string; // the UPI account it landed in ("" for cash)
  date: string; // dd-mm-yy
  at: string; // createdAt ISO — used for the time + newest-first sort
  by: string; // enteredBy (local user id)
  quoteNo: string;
  /** derived from the quote's own payCash/payUpi (legacy payment never itemised as its own expense). */
  synthetic?: boolean;
}

/** Build one statement line from a recorded sale expense (shared by party + quote rollups). */
const mkStatement = (e: Expense, quoteNo: string): PartyStatement => ({
  id: e.id,
  amount: +e.amount || 0,
  mode: e.mode,
  account: e.account || "",
  date: e.date,
  at: e.createdAt || "",
  by: e.enteredBy,
  quoteNo,
});

/** Surface any paid amount recorded on the quote itself (payCash/payUpi) that was never written
 *  as its own expense — so an old cash payment still shows as a recorded statement. Never mutates. */
export function reconcileStatements(d: Doc, statements: PartyStatement[]): PartyStatement[] {
  const sumBy = (m: PayMode) => statements.reduce((t, s) => (s.mode === m ? t + s.amount : t), 0);
  const out = [...statements];
  const add = (mode: PayMode, amount: number) =>
    out.push({ id: d.id + ":" + mode, amount: r2(amount), mode, account: "", date: d.date, at: "", by: "", quoteNo: d.number, synthetic: true });
  const missCash = r2((d.payCash || 0) - sumBy("cash"));
  const missUpi = r2((d.payUpi || 0) - sumBy("upi"));
  if (missCash > 0.5) add("cash", missCash);
  if (missUpi > 0.5) add("upi", missUpi);
  return out;
}

/** This one quote's recorded payments as statement lines (newest first), including any legacy
 *  payCash/payUpi never itemised as its own expense. Same rollup quoteLedger does, for a single quote. */
export function statementsForQuote(d: Doc, expenses: Expense[]): PartyStatement[] {
  const lines = expenses.filter((e) => e.type === "sale" && e.sourceId === d.id).map((e) => mkStatement(e, d.number));
  return reconcileStatements(d, lines).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

export interface PartyQuote {
  id: string;
  number: string;
  bill: number;
  paid: number;
  balance: number;
  status: string;
}

/** A customer rolled up across all their created quotes: how much billed, paid, and still due. */
export interface Party {
  custId: string;
  name: string;
  phone: string;
  billed: number;
  paid: number;
  cashPaid: number;
  upiPaid: number;
  balance: number; // billed − paid (positive = they owe us)
  quoteCount: number;
  quotes: PartyQuote[];
  statements: PartyStatement[];
}

export interface PartyLedger {
  parties: Party[]; // sorted by balance desc (most pending first)
  totalBilled: number;
  totalPaid: number;
  totalPending: number; // Σ of positive balances (money still owed to us)
}

/** Roll every created quote + its recorded payments up into per-customer balances + statements. */
export function partyLedger(quotes: Doc[], expenses: Expense[], customers: Customer[] = []): PartyLedger {
  // a quote is a "bill" once it's Created (drafts aren't owed yet)
  const created = quotes.filter((d) => d.status === "Created");
  const key = (d: Doc) => d.customerId || "name:" + (d.customerName || "").trim().toLowerCase() + "|" + (d.phone || "");
  const quoteNoById = new Map(quotes.map((d) => [d.id, d.number] as const));

  const map = new Map<string, Party>();
  const quoteOwner = new Map<string, string>(); // quoteId → party key (for linking statements)
  for (const d of created) {
    const k = key(d);
    let p = map.get(k);
    if (!p) {
      p = {
        custId: d.customerId || "",
        name: (d.customerName || "").trim() || "Walk-in",
        phone: d.phone || "",
        billed: 0, paid: 0, cashPaid: 0, upiPaid: 0, balance: 0, quoteCount: 0, quotes: [], statements: [],
      };
      map.set(k, p);
    }
    const b = quoteBill(d);
    const pd = +d.amountPaid || 0;
    p.billed += b;
    p.paid += pd;
    p.cashPaid += d.payCash || 0;
    p.upiPaid += d.payUpi || 0;
    p.quoteCount++;
    p.quotes.push({ id: d.id, number: d.number, bill: r2(b), paid: r2(pd), balance: r2(b - pd), status: d.status });
    if (!p.custId) p.custId = d.customerId || "";
    if (!p.phone) p.phone = d.phone || "";
    quoteOwner.set(d.id, k);
  }

  // attach each recorded sale (accept-payment writes type "sale" with sourceId = quote id)
  for (const e of expenses) {
    if (e.type !== "sale" || !e.sourceId) continue;
    const k = quoteOwner.get(e.sourceId);
    if (!k) continue;
    map.get(k)!.statements.push(mkStatement(e, quoteNoById.get(e.sourceId) || ""));
  }

  // fold in each customer's opening balance (old dues before the app) — adds to what they owe
  for (const c of customers) {
    const op = +(c.opening || 0) || 0;
    if (Math.abs(op) < 0.005) continue;
    let p = map.get(c.id);
    if (!p) {
      p = { custId: c.id, name: c.name || "Walk-in", phone: c.phone || "",
        billed: 0, paid: 0, cashPaid: 0, upiPaid: 0, balance: 0, quoteCount: 0, quotes: [], statements: [] };
      map.set(c.id, p);
    }
    p.billed += op;
  }

  const parties = [...map.values()].map((p) => ({
    ...p,
    billed: r2(p.billed),
    paid: r2(p.paid),
    cashPaid: r2(p.cashPaid),
    upiPaid: r2(p.upiPaid),
    balance: r2(p.billed - p.paid),
    statements: p.statements.sort((a, b) => (b.at || "").localeCompare(a.at || "")),
    quotes: p.quotes.sort((a, b) => (b.number || "").localeCompare(a.number || "")),
  }));
  parties.sort((a, b) => b.balance - a.balance);

  return {
    parties,
    totalBilled: r2(parties.reduce((s, p) => s + p.billed, 0)),
    totalPaid: r2(parties.reduce((s, p) => s + p.paid, 0)),
    totalPending: r2(parties.reduce((s, p) => s + Math.max(0, p.balance), 0)),
  };
}

/** One created quotation with its full payment history (every statement's metadata). */
export interface QuoteStatements {
  id: string;
  number: string;
  name: string;
  phone: string;
  date: string;
  bill: number;
  paid: number;
  balance: number;
  status: string;
  statements: PartyStatement[]; // this quote's payments, newest first
}

export interface QuoteLedger {
  quotes: QuoteStatements[]; // newest quote first
  quoteCount: number;
  payCount: number; // total statements recorded
  totalReceived: number;
}

/** Roll each created quote up with its own recorded payments — the per-quotation statement view. */
export function quoteLedger(quotes: Doc[], expenses: Expense[]): QuoteLedger {
  const created = quotes.filter((d) => d.status === "Created");
  const byQuote = new Map<string, PartyStatement[]>();
  const quoteNoById = new Map(quotes.map((d) => [d.id, d.number] as const));
  for (const e of expenses) {
    if (e.type !== "sale" || !e.sourceId) continue;
    const list = byQuote.get(e.sourceId) || [];
    list.push(mkStatement(e, quoteNoById.get(e.sourceId) || ""));
    byQuote.set(e.sourceId, list);
  }

  const rows: QuoteStatements[] = created
    .map((d) => {
      const bill = quoteBill(d);
      const paid = +d.amountPaid || 0;
      const statements = reconcileStatements(d, byQuote.get(d.id) || []).sort((a, b) =>
        (b.at || "").localeCompare(a.at || ""),
      );
      return {
        id: d.id,
        number: d.number,
        name: (d.customerName || "").trim() || "Walk-in",
        phone: d.phone || "",
        date: d.date,
        bill: r2(bill),
        paid: r2(paid),
        balance: r2(bill - paid),
        status: d.status,
        statements,
      };
    })
    .sort((a, b) => (b.number || "").localeCompare(a.number || ""));

  return {
    quotes: rows,
    quoteCount: rows.length,
    payCount: rows.reduce((s, r) => s + r.statements.length, 0),
    totalReceived: r2(rows.reduce((s, r) => s + r.statements.reduce((t, x) => t + x.amount, 0), 0)),
  };
}
