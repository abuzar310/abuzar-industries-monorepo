// Named payment accounts (UPI + cash held by Tabrez, Afsar, etc.) — registry + rollup + daily collect.
import { allRec, metaGet, metaSet, put } from "./db";
import { nowIso, todayStr, uid } from "./calc";
import { trySync } from "./cloud";
import type { Customer, Doc, Expense } from "./types";

const isUpi = (e: Expense) => e.type === "sale" && e.mode === "upi";

const META_KEY = "payAccounts";
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PayAccount {
  id: string;
  name: string;
  createdAt: string;
}

/** One payment credited to a named account. */
export interface AccountEntry {
  id: string;
  amount: number;
  mode: "cash" | "upi";
  date: string;
  at: string;
  by: string;
  customer: string;
  quoteNo: string;
  note?: string;
  toOwner?: boolean;
  collected: boolean;
  collectedAt?: string;
}

export interface AccountDaySummary {
  name: string;
  upiTotal: number;
  cashTotal: number;
  total: number;
  pending: number;
  collected: number;
  count: number;
  entries: AccountEntry[]; // newest first
}

export interface AccountDayLedger {
  date: string;
  accounts: AccountDaySummary[];
  pendingTotal: number;
  collectedTotal: number;
  dayTotal: number;
  accountCount: number;
}

/** One day in the date navigator strip. */
export interface DateSummary {
  date: string;
  pending: number;
  collected: number;
  total: number;
}

/** Overall picture across all dates — pending, received, and per-day list for navigation. */
export interface AccountOverview {
  pendingTotal: number;
  collectedTotal: number;
  receivedTotal: number;
  upiTotal: number;
  cashTotal: number;
  byAccount: { name: string; pending: number; total: number }[];
  dates: DateSummary[]; // newest first
}

/** @deprecated use accountDayLedger — lifetime rollup kept for any legacy callers */
export interface AccountSummary {
  name: string;
  upiTotal: number;
  cashTotal: number;
  total: number;
  count: number;
  entries: AccountEntry[];
}

export interface AccountLedger {
  accounts: AccountSummary[];
  totalUpi: number;
  totalCash: number;
  grandTotal: number;
  accountCount: number;
}

const loadRegistry = () => metaGet<PayAccount[]>(META_KEY, []);

const isAccountPayment = (e: Expense) => {
  if (e.type !== "sale" || e.charge) return false;
  const acct = (e.account || "").trim();
  if (isUpi(e)) return !!acct;
  return !!acct;
};

const partyName = (e: Expense, quotes: Doc[], customers: Customer[]) => {
  if (e.sourceId) {
    const q = quotes.find((d) => d.id === e.sourceId);
    if (q) return (q.customerName || "").trim() || "Walk-in";
  }
  if (e.custId) {
    const c = customers.find((x) => x.id === e.custId);
    if (c) return c.name;
  }
  return (e.label || e.note || "").split(" · ")[0] || "—";
};

const quoteNo = (e: Expense, quotes: Doc[]) => {
  if (!e.sourceId) return "";
  return quotes.find((d) => d.id === e.sourceId)?.number || "";
};

/** dd-mm-yy → sortable yyyy-mm-dd */
const dateKey = (d: string) => {
  const [dd, mm, yy] = (d || "").split("-");
  return dd && mm && yy ? `20${yy}-${mm}-${dd}` : "";
};

const mkEntry = (e: Expense, quotes: Doc[], customers: Customer[]): AccountEntry => ({
  id: e.id,
  amount: +e.amount || 0,
  mode: e.mode === "upi" ? "upi" : "cash",
  date: e.date,
  at: e.createdAt || "",
  by: e.enteredBy,
  customer: partyName(e, quotes, customers),
  quoteNo: quoteNo(e, quotes),
  note: e.label || e.note,
  toOwner: !!e.toOwner,
  collected: !!e.collectedAt,
  collectedAt: e.collectedAt,
});

/** All known account names — registry + any used on past payments. */
export async function payAccounts(): Promise<string[]> {
  const [registry, expenses] = await Promise.all([loadRegistry(), allRec<Expense>("expenses")]);
  const used = expenses.filter(isAccountPayment).map((e) => (e.account || "").trim()).filter(Boolean);
  return [...new Set([...registry.map((a) => a.name), ...used])].sort();
}

/** @deprecated use payAccounts */
export const upiAccounts = payAccounts;

export async function listPayAccounts(): Promise<PayAccount[]> {
  return loadRegistry();
}

export async function addPayAccount(name: string): Promise<PayAccount | null> {
  const n = name.trim();
  if (!n) return null;
  const list = await loadRegistry();
  if (list.some((a) => a.name.toLowerCase() === n.toLowerCase())) return null;
  const acct: PayAccount = { id: "ACC-" + uid(), name: n, createdAt: nowIso() };
  await metaSet(META_KEY, [...list, acct]);
  return acct;
}

export async function removePayAccount(id: string): Promise<void> {
  const list = await loadRegistry();
  await metaSet(
    META_KEY,
    list.filter((a) => a.id !== id),
  );
}

/** Per-account rollup for one day — pending vs already collected. */
export function accountDayLedger(
  expenses: Expense[],
  date: string,
  quotes: Doc[] = [],
  customers: Customer[] = [],
): AccountDayLedger {
  const map = new Map<string, AccountDaySummary>();

  for (const e of expenses) {
    if (!isAccountPayment(e) || e.date !== date) continue;
    const name = (e.account || "").trim() || "Unassigned";
    let a = map.get(name);
    if (!a) {
      a = { name, upiTotal: 0, cashTotal: 0, total: 0, pending: 0, collected: 0, count: 0, entries: [] };
      map.set(name, a);
    }
    const entry = mkEntry(e, quotes, customers);
    const amt = entry.amount;
    a.entries.push(entry);
    a.count++;
    if (e.mode === "upi") a.upiTotal += amt;
    else a.cashTotal += amt;
    a.total += amt;
    if (entry.collected) a.collected += amt;
    else a.pending += amt;
  }

  const accounts = [...map.values()]
    .map((a) => ({
      ...a,
      upiTotal: r2(a.upiTotal),
      cashTotal: r2(a.cashTotal),
      total: r2(a.total),
      pending: r2(a.pending),
      collected: r2(a.collected),
      entries: a.entries.sort((x, y) => (y.at || "").localeCompare(x.at || "")),
    }))
    .sort((a, b) => b.pending - a.pending || b.total - a.total);

  return {
    date,
    accounts,
    pendingTotal: r2(accounts.reduce((s, a) => s + a.pending, 0)),
    collectedTotal: r2(accounts.reduce((s, a) => s + a.collected, 0)),
    dayTotal: r2(accounts.reduce((s, a) => s + a.total, 0)),
    accountCount: accounts.length,
  };
}

/** How much is still uncollected on any earlier day (not including `date`). */
export function overduePending(expenses: Expense[], beforeDate: string): number {
  const cut = dateKey(beforeDate);
  let t = 0;
  for (const e of expenses) {
    if (!isAccountPayment(e) || e.collectedAt) continue;
    if (dateKey(e.date) >= cut) continue;
    t += +e.amount || 0;
  }
  return r2(t);
}

/** Overall totals + per-day summaries for the date navigator. */
export function accountOverview(expenses: Expense[]): AccountOverview {
  const acctMap = new Map<string, { pending: number; total: number }>();
  const dateMap = new Map<string, DateSummary>();
  let pendingTotal = 0;
  let collectedTotal = 0;
  let upiTotal = 0;
  let cashTotal = 0;

  for (const e of expenses) {
    if (!isAccountPayment(e)) continue;
    const amt = +e.amount || 0;
    const name = (e.account || "").trim() || "Unassigned";
    const done = !!e.collectedAt;

    const ac = acctMap.get(name) || { pending: 0, total: 0 };
    ac.total += amt;
    if (!done) ac.pending += amt;
    acctMap.set(name, ac);

    const ds = dateMap.get(e.date) || { date: e.date, pending: 0, collected: 0, total: 0 };
    ds.total += amt;
    if (done) ds.collected += amt;
    else ds.pending += amt;
    dateMap.set(e.date, ds);

    if (done) collectedTotal += amt;
    else pendingTotal += amt;
    if (e.mode === "upi") upiTotal += amt;
    else cashTotal += amt;
  }

  return {
    pendingTotal: r2(pendingTotal),
    collectedTotal: r2(collectedTotal),
    receivedTotal: r2(pendingTotal + collectedTotal),
    upiTotal: r2(upiTotal),
    cashTotal: r2(cashTotal),
    byAccount: [...acctMap.entries()]
      .map(([name, v]) => ({ name, pending: r2(v.pending), total: r2(v.total) }))
      .sort((a, b) => b.pending - a.pending || b.total - a.total),
    dates: [...dateMap.values()]
      .map((d) => ({ ...d, pending: r2(d.pending), collected: r2(d.collected), total: r2(d.total) }))
      .sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date))),
  };
}

/** Oldest day that still has uncollected payments — for "jump to overdue" navigation. */
export function oldestPendingDate(expenses: Expense[]): string | null {
  let oldest: string | null = null;
  for (const e of expenses) {
    if (!isAccountPayment(e) || e.collectedAt) continue;
    if (!oldest || dateKey(e.date) < dateKey(oldest)) oldest = e.date;
  }
  return oldest;
}

/** Mark every uncollected payment to `account` on `date` as physically collected. Returns ₹ collected. */
export async function collectAccountDay(account: string, date: string, by: string): Promise<number> {
  const now = nowIso();
  let total = 0;
  for (const e of await allRec<Expense>("expenses")) {
    if (!isAccountPayment(e)) continue;
    if ((e.account || "").trim() !== account || e.date !== date || e.collectedAt) continue;
    e.collectedAt = now;
    e.collectedBy = by;
    e.updatedAt = now;
    e.synced = false;
    await put("expenses", e);
    total += +e.amount || 0;
  }
  if (total > 0) trySync();
  return r2(total);
}

/** Lifetime rollup (all dates, ignores collected state). */
export function accountLedger(expenses: Expense[], quotes: Doc[] = [], customers: Customer[] = []): AccountLedger {
  const map = new Map<string, AccountSummary>();

  for (const e of expenses) {
    if (!isAccountPayment(e)) continue;
    const name = (e.account || "").trim() || "Unassigned";
    let a = map.get(name);
    if (!a) {
      a = { name, upiTotal: 0, cashTotal: 0, total: 0, count: 0, entries: [] };
      map.set(name, a);
    }
    const entry = mkEntry(e, quotes, customers);
    a.entries.push(entry);
    a.count++;
    if (e.mode === "upi") a.upiTotal += entry.amount;
    else a.cashTotal += entry.amount;
    a.total += entry.amount;
  }

  const accounts = [...map.values()]
    .map((a) => ({
      ...a,
      upiTotal: r2(a.upiTotal),
      cashTotal: r2(a.cashTotal),
      total: r2(a.total),
      entries: a.entries.sort((x, y) => (y.at || "").localeCompare(x.at || "")),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    accounts,
    totalUpi: r2(accounts.reduce((s, a) => s + a.upiTotal, 0)),
    totalCash: r2(accounts.reduce((s, a) => s + a.cashTotal, 0)),
    grandTotal: r2(accounts.reduce((s, a) => s + a.total, 0)),
    accountCount: accounts.length,
  };
}

export { todayStr };
