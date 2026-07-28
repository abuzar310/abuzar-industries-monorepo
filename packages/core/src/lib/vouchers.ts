// Simple business vouchers (official app): RECEIPTS = money received against invoices
// (or as a customer ADVANCE before any invoice exists), PAYMENT VOUCHERS = money paid
// out (cash or a named bank account). Backed by the expenses store — no double-entry.
import { allRec, delRec, metaGet, metaSet, put } from "./data";
import { addExpense } from "./expenses";
import { computeDoc, nowIso, uid } from "./calc";
import type { Doc, Expense } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cash cap: max ₹ cash accepted from ONE customer per day (rest must come by bank). */
export const CASH_DAY_LIMIT = 10000;

// ---- bank accounts (shared setting, editable on the Vouchers tab) ----

const BANKS_KEY = "bankAccounts";
export const getBankAccounts = () => metaGet<string[]>(BANKS_KEY, []);
export async function addBankAccount(name: string): Promise<string[]> {
  const n = (name || "").trim();
  const cur = await getBankAccounts();
  if (!n || cur.some((x) => x.toLowerCase() === n.toLowerCase())) return cur;
  const next = [...cur, n];
  await metaSet(BANKS_KEY, next);
  return next;
}

/** Remove a bank account from the quick-pick (old vouchers keep the name they recorded). */
export async function removeBankAccount(name: string): Promise<string[]> {
  const cur = await getBankAccounts();
  const next = cur.filter((x) => x !== name);
  await metaSet(BANKS_KEY, next);
  return next;
}

// ---- payment vouchers (money OUT) ----

/** Payment vouchers are "custom" expenses tagged by this sourceId prefix. */
export const PV_PREFIX = "pv:";
export const isPaymentVoucher = (e: Expense) => e.type === "custom" && (e.sourceId || "").startsWith(PV_PREFIX);

export async function recordPaymentVoucher(f: {
  payee: string;
  amount: number;
  via: "cash" | "bank";
  bank?: string;
  /** dd-mm-yy */
  date?: string;
  note?: string;
  by: string;
}): Promise<Expense> {
  return addExpense({
    type: "custom",
    label: (f.payee || "").trim(),
    amount: f.amount,
    mode: "cash", // outflows normalise mode away — `account` tells bank from cash
    account: f.via === "bank" ? (f.bank || "").trim() : "",
    note: f.note,
    sourceId: PV_PREFIX + uid(),
    date: f.date,
    enteredBy: f.by,
  });
}

// ---- the ₹10k/day cash rule ----

/** ₹ cash already received from this customer on `date` (dd-mm-yy) — invoice payments
 *  AND account advances both count toward the daily cap. */
export async function cashTakenFromCustomerOn(customerId: string, date: string, expenses: Expense[]): Promise<number> {
  if (!customerId) return 0;
  const invs = await allRec<Doc>("invoices");
  const ids = new Set(invs.filter((d) => d.customerId === customerId).map((d) => d.id));
  return r2(
    expenses
      .filter(
        (e) =>
          e.type === "sale" && e.mode === "cash" && !e.charge && e.date === date &&
          ((!!e.sourceId && ids.has(e.sourceId)) || e.custId === customerId),
      )
      .reduce((s, e) => s + (+e.amount || 0), 0),
  );
}

// ---- customer advances (money received BEFORE any invoice exists) ----

/** Record an advance from a customer — sits on their account until a future invoice absorbs it. */
export async function recordAdvanceReceipt(f: {
  custId: string;
  custName: string;
  amount: number;
  via: "cash" | "bank";
  bank?: string;
  /** dd-mm-yy */
  date?: string;
  note?: string;
  by: string;
}): Promise<Expense> {
  return addExpense({
    type: "sale",
    amount: f.amount,
    mode: f.via === "bank" ? "upi" : "cash",
    account: f.via === "bank" ? (f.bank || "").trim() : "",
    custId: f.custId,
    note: f.custName,
    label: (f.note || "").trim(),
    date: f.date,
    enteredBy: f.by,
  });
}

/** A customer's unapplied advances, oldest first. */
export const advancesOf = (expenses: Expense[], custId: string): Expense[] =>
  expenses
    .filter((e) => e.type === "sale" && e.custId === custId && !e.charge)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

/** ₹ still sitting as advance on the customer's account. */
export const advanceBalance = (expenses: Expense[], custId: string): number =>
  r2(advancesOf(expenses, custId).reduce((s, e) => s + (+e.amount || 0), 0));

/** Waterfall the customer's advances onto this invoice: each advance becomes a payment ON
 *  the invoice (keeping its original date / cash-or-bank), and the advance row shrinks or
 *  disappears — money is conserved, never double-counted. Returns the new totals so the
 *  caller can update the live editor doc; set `persist` to write the invoice here instead. */
export async function applyAdvancesToInvoice(
  inv: Doc,
  opts: { persist?: boolean } = {},
): Promise<{ applied: number; payCash: number; payUpi: number }> {
  const zero = { applied: 0, payCash: +(inv.payCash || 0), payUpi: +(inv.payUpi || 0) };
  if (!inv.customerId || inv.kind !== "invoice" || inv.rented || inv.tradeType === "buy") return zero;
  const expenses = await allRec<Expense>("expenses");
  const adv = advancesOf(expenses, inv.customerId);
  if (!adv.length) return zero;
  const grand = computeDoc(inv).grand;
  let payCash = zero.payCash;
  let payUpi = zero.payUpi;
  let due = r2(grand - r2(payCash + payUpi));
  let applied = 0;
  for (const a of adv) {
    if (due <= 0.5) break;
    const use = Math.min(due, r2(+a.amount || 0));
    if (use <= 0) continue;
    // 1) the advance becomes a real payment on this invoice (original date + mode kept)
    await addExpense({
      type: "sale",
      amount: use,
      mode: a.mode === "upi" ? "upi" : "cash",
      account: a.account || "",
      label: ["Advance applied", a.label].filter(Boolean).join(" · "),
      note: (inv.customerName || "Walk-in") + " · " + inv.number,
      sourceId: inv.id,
      date: a.date,
      enteredBy: a.enteredBy,
    });
    // 2) shrink / remove the account advance by exactly the same amount
    if (use >= (+a.amount || 0) - 0.005) {
      await delRec("expenses", a.id); // soft delete
    } else {
      const rest = { ...a, amount: r2((+a.amount || 0) - use), updatedAt: nowIso() };
      await put("expenses", rest);
    }
    if (a.mode === "upi") payUpi = r2(payUpi + use);
    else payCash = r2(payCash + use);
    applied = r2(applied + use);
    due = r2(due - use);
  }
  if (applied > 0 && opts.persist) {
    inv.payCash = payCash;
    inv.payUpi = payUpi;
    inv.amountPaid = r2(payCash + payUpi);
    inv.paymentStatus = inv.amountPaid <= 0 ? "Pending" : inv.amountPaid + 0.001 >= grand ? "Paid" : "Partial";
    inv.paidLogged = inv.amountPaid > 0;
    inv.updatedAt = nowIso();
    await put("invoices", inv);
  }
  return { applied, payCash, payUpi };
}
