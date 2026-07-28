// Simple business vouchers (official app): RECEIPTS = money received against invoices,
// PAYMENT VOUCHERS = money paid out (cash or a named bank account).
// Backed by the expenses store — no double-entry, just clean date-wise books.
import { allRec, metaGet, metaSet } from "./data";
import { addExpense } from "./expenses";
import { uid } from "./calc";
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

/** ₹ cash already received from this customer on `date` (dd-mm-yy), across all their invoices. */
export async function cashTakenFromCustomerOn(customerId: string, date: string, expenses: Expense[]): Promise<number> {
  if (!customerId) return 0;
  const invs = await allRec<Doc>("invoices");
  const ids = new Set(invs.filter((d) => d.customerId === customerId).map((d) => d.id));
  return r2(
    expenses
      .filter((e) => e.type === "sale" && e.mode === "cash" && !!e.sourceId && ids.has(e.sourceId) && e.date === date)
      .reduce((s, e) => s + (+e.amount || 0), 0),
  );
}
