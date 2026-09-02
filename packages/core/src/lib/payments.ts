import { quoteBill as quoteBillOf, quoteOwnBill as quoteOwnBillOf } from "./calc";
import { isQuoteCommissionPay } from "./expenses";
import type { Customer, Doc, Expense, PayMode } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** the effective bill of a quote: accepted Final price (else wood+GST) plus permit and old balance. */
export const quoteBill = (d: Doc) => quoteBillOf(d);
/** this quote's own sale — excludes old dues carried onto the paper (already on older bills). */
export const quoteOwnBill = (d: Doc) => quoteOwnBillOf(d);

/** Cash + UPI + wood-against-commission recorded on the quote. */
export const quotePaid = (d: Pick<Doc, "payCash" | "payUpi" | "payCommission">) =>
  r2((+(d.payCash || 0)) + (+(d.payUpi || 0)) + (+(d.payCommission || 0)));

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
  /** free-text note on the payment (e.g. a cash note) — stored on the expense's label. */
  note?: string;
  /** cash that went straight to the owner (not in the manager's daybook). */
  toOwner?: boolean;
  /** wood taken against carpenter commission — not cash / UPI. */
  commission?: boolean;
  /** derived from the quote's own payCash/payUpi (legacy payment never itemised as its own expense). */
  synthetic?: boolean;
  /** groups the pieces of one split customer receipt (see receipts.ts). */
  rcptId?: string;
  /** merged line: how many pieces the one receipt was applied as. */
  pieces?: number;
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
  note: e.label || "",
  toOwner: !!e.toOwner,
  rcptId: e.rcptId,
});

/** A split receipt is ONE handover of money: show its pieces back as the single amount,
 *  with a note saying which quotations it settled. Display-only — the math elsewhere
 *  (quote paid totals, party rollups) still works on the real pieces. */
export function mergeReceiptPieces(statements: PartyStatement[]): PartyStatement[] {
  const out: PartyStatement[] = [];
  const groups = new Map<string, PartyStatement[]>();
  for (const s of statements) {
    if (s.rcptId) {
      const g = groups.get(s.rcptId) || [];
      g.push(s);
      groups.set(s.rcptId, g);
    } else {
      out.push(s);
    }
  }
  for (const [id, g] of groups) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const first = g[0];
    const quoteNos = g.map((x) => x.quoteNo).filter(Boolean);
    const rest = g.some((x) => !x.quoteNo);
    const settled =
      (quoteNos.length ? "settled #" + quoteNos.join(", #") : "") +
      (rest ? (quoteNos.length ? " + account" : "on account") : "");
    out.push({
      ...first,
      id,
      amount: r2(g.reduce((t, x) => t + x.amount, 0)),
      quoteNo: "",
      pieces: g.length,
      note: [first.note, settled].filter(Boolean).join(" · "),
    });
  }
  return out;
}

function mkPayLine(e: Expense, quoteNo: string): PartyStatement {
  const s = mkStatement(e, quoteNo);
  if (isQuoteCommissionPay(e)) {
    s.commission = true;
    s.mode = "";
    s.note = [e.carpenter, e.party, e.note].filter(Boolean).join(" · ") || e.label || "";
  }
  return s;
}

function isQuotePayExpense(e: Expense): boolean {
  if (!e.sourceId) return false;
  return e.type === "sale" || isQuoteCommissionPay(e);
}

/** Surface any paid amount recorded on the quote itself (payCash/payUpi) that was never written
 *  as its own expense — so an old cash payment still shows as a recorded statement. Never mutates. */
export function reconcileStatements(d: Doc, statements: PartyStatement[]): PartyStatement[] {
  const sumBy = (m: PayMode) => statements.reduce((t, s) => (!s.commission && s.mode === m ? t + s.amount : t), 0);
  const out = [...statements];
  const add = (mode: PayMode, amount: number, extra?: Partial<PartyStatement>) =>
    out.push({
      id: d.id + ":" + (extra?.commission ? "commission" : mode),
      amount: r2(amount),
      mode,
      account: "",
      date: d.date,
      at: "",
      by: "",
      quoteNo: d.number,
      synthetic: true,
      ...extra,
    });
  const missCash = r2((d.payCash || 0) - sumBy("cash"));
  const missUpi = r2((d.payUpi || 0) - sumBy("upi"));
  const missComm = r2(
    (d.payCommission || 0) - statements.reduce((t, s) => (s.commission ? t + s.amount : t), 0),
  );
  if (missCash > 0.5) add("cash", missCash);
  if (missUpi > 0.5) add("upi", missUpi);
  if (missComm > 0.5) add("", missComm, { commission: true });
  return out;
}

/** This one quote's recorded payments as statement lines (newest first), including any legacy
 *  payCash/payUpi never itemised as its own expense. Same rollup quoteLedger does, for a single quote. */
export function statementsForQuote(d: Doc, expenses: Expense[]): PartyStatement[] {
  const lines = expenses.filter((e) => e.sourceId === d.id && isQuotePayExpense(e)).map((e) => mkPayLine(e, d.number));
  return reconcileStatements(d, lines).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/** What Balances / Statements / the editor Payment block all count as received on this quote.
 *  Itemised daybook lines win when they exist; leftover payCash/payUpi on the quote (never
 *  written as an expense) still counts via reconcileStatements. */
export function quoteReceived(d: Doc, expenses: Expense[]): number {
  return r2(statementsForQuote(d, expenses).reduce((s, l) => s + l.amount, 0));
}

/** Never let a later Cut Size quote Save drop cash/UPI below the daybook lines still
 *  linked to it. No-op on invoices and when there are no linked lines (so a real
 *  Clear payments, and official/Tally docs, are left alone). Mutates `d` only when
 *  a floor actually applies. */
export function floorQuotePaidFromExpenses(d: Doc, expenses: Expense[]): void {
  if (d.kind === "invoice") return;
  let cash = 0;
  let upi = 0;
  let comm = 0;
  for (const e of expenses) {
    if (e.sourceId !== d.id) continue;
    const amt = +e.amount || 0;
    if (isQuoteCommissionPay(e)) comm += amt;
    else if (e.type === "sale" && !e.charge) {
      if (e.mode === "upi") upi += amt;
      else cash += amt;
    }
  }
  if (cash + upi + comm < 0.005) return;
  d.payCash = r2(Math.max(+(d.payCash || 0), cash));
  d.payUpi = r2(Math.max(+(d.payUpi || 0), upi));
  d.payCommission = r2(Math.max(+(d.payCommission || 0), comm));
  d.amountPaid = quotePaid(d);
  const fp = quoteBill(d);
  d.paymentStatus = d.amountPaid <= 0 ? "Pending" : d.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
  d.paidLogged = d.amountPaid > 0;
}

export interface PartyQuote {
  id: string;
  number: string;
  /** Recycled display number (shown to user). Falls back to number if not set. */
  displayNumber?: string;
  date: string;
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
  // A quote counts as a bill once it's Created — OR once any money has been recorded against it
  // (an advance on a still-Draft quote). This mirrors the Statements ledger (quoteLedger) exactly,
  // so the two views always reconcile: money shown in Statements can never go missing from Balances.
  // Trashed quotes are excluded.
  const paidSrc = new Set(
    expenses.filter((e) => isQuotePayExpense(e)).map((e) => e.sourceId as string),
  );
  const billable = quotes.filter(
    (d) =>
      !d.deletedAt &&
      (d.status === "Created" ||
        paidSrc.has(d.id) ||
        (+(d.payCash || 0)) > 0 ||
        (+(d.payUpi || 0)) > 0 ||
        (+(d.payCommission || 0)) > 0 ||
        (+(d.amountPaid || 0)) > 0),
  );
  const key = (d: Doc) => d.customerId || "name:" + (d.customerName || "").trim().toLowerCase() + "|" + (d.phone || "");

  const map = new Map<string, Party>();
  for (const d of billable) {
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
    const b = quoteOwnBill(d);
    const stmts = statementsForQuote(d, expenses);
    const pd = r2(stmts.reduce((s, l) => s + l.amount, 0));
    p.billed += b;
    p.paid += pd;
    p.cashPaid += stmts.reduce((s, l) => (!l.commission && l.mode === "cash" ? s + l.amount : s), 0);
    p.upiPaid += stmts.reduce((s, l) => (l.mode === "upi" ? s + l.amount : s), 0);
    p.quoteCount++;
    p.quotes.push({ id: d.id, number: d.number, displayNumber: d.displayNumber, date: d.date, bill: r2(b), paid: r2(pd), balance: r2(b - pd), status: d.status });
    p.statements.push(...stmts);
    if (!p.custId) p.custId = d.customerId || "";
    if (!p.phone) p.phone = d.phone || "";
  }

  // fold in each customer's opening balance (old dues before the app) — adds to what they owe
  const custById = new Map(customers.map((c) => [c.id, c] as const));
  const newParty = (id: string) => {
    const c = custById.get(id);
    const p: Party = {
      custId: id, name: c?.name || "Walk-in", phone: c?.phone || "",
      billed: 0, paid: 0, cashPaid: 0, upiPaid: 0, balance: 0, quoteCount: 0, quotes: [], statements: [],
    };
    map.set(id, p);
    return p;
  };
  for (const c of customers) {
    const op = +(c.opening || 0) || 0;
    if (Math.abs(op) < 0.005) continue;
    (map.get(c.id) || newParty(c.id)).billed += op;
  }

  // standalone Receipts-tab entries against a customer (no quote): a charge adds to what they owe,
  // a receipt reduces it (and shows as a statement)
  for (const e of expenses) {
    if (e.type !== "sale" || !e.custId || e.sourceId) continue;
    const p = map.get(e.custId) || newParty(e.custId);
    const amt = +e.amount || 0;
    if (e.charge) {
      p.billed += amt;
    } else {
      p.paid += amt;
      if (e.mode === "upi") p.upiPaid += amt;
      else p.cashPaid += amt;
      p.statements.push(mkStatement(e, ""));
    }
  }

  const parties = [...map.values()].map((p) => ({
    ...p,
    billed: r2(p.billed),
    paid: r2(p.paid),
    cashPaid: r2(p.cashPaid),
    upiPaid: r2(p.upiPaid),
    balance: r2(p.billed - p.paid),
    // one receipt = one line, even when it was applied across several quotations
    statements: mergeReceiptPieces(p.statements).sort((a, b) => (b.at || "").localeCompare(a.at || "")),
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

/** What they still owe on older bills — this quote is left out so carrying dues onto it cannot loop. */
export function priorDueOf(
  quotes: Doc[],
  expenses: Expense[],
  customers: Customer[],
  doc: Pick<Doc, "id" | "customerId" | "customerName" | "phone">,
): number {
  const id = (doc.customerId || "").trim();
  const name = (doc.customerName || "").trim().toLowerCase();
  if (!id && !name) return 0;
  const others = quotes.filter((d) => d.id !== doc.id);
  const rest = expenses.filter((e) => e.sourceId !== doc.id);
  const p = partyLedger(others, rest, customers).parties.find((x) => {
    if (id && x.custId === id) return true;
    return (x.name || "").trim().toLowerCase() === name && (!doc.phone || !x.phone || x.phone === doc.phone);
  });
  return p && p.balance > 0.5 ? r2(p.balance) : 0;
}

/** One created quotation with its full payment history (every statement's metadata). */
export interface QuoteStatements {
  id: string;
  number: string;
  /** Recycled display number (shown to user). Falls back to number if not set. */
  displayNumber?: string;
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
  const byQuote = new Map<string, PartyStatement[]>();
  const quoteNoById = new Map(quotes.map((d) => [d.id, d.number] as const));
  for (const e of expenses) {
    if (!isQuotePayExpense(e) || !e.sourceId) continue;
    const list = byQuote.get(e.sourceId) || [];
    list.push(mkPayLine(e, quoteNoById.get(e.sourceId) || ""));
    byQuote.set(e.sourceId, list);
  }
  // show a quote if it's Created OR carries any payment — an advance on a still-Draft quote appears too;
  // trashed quotes are excluded (they live in the Recycle bin)
  const shown = quotes.filter(
    (d) =>
      !d.deletedAt &&
      (d.status === "Created" ||
        byQuote.has(d.id) ||
        (+(d.payCash || 0)) > 0 ||
        (+(d.payUpi || 0)) > 0 ||
        (+(d.payCommission || 0)) > 0),
  );

  const rows: QuoteStatements[] = shown
    .map((d) => {
      const bill = quoteBill(d);
      const statements = reconcileStatements(d, byQuote.get(d.id) || []).sort((a, b) =>
        (b.at || "").localeCompare(a.at || ""),
      );
      const paid = r2(statements.reduce((s, l) => s + l.amount, 0));
      return {
        id: d.id,
        number: d.number,
        displayNumber: d.displayNumber,
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
