// Named payment accounts (UPI + cash held by Tabrez, Afsar, etc.) — registry + rollup + daily collect.
import { allRec, delRec, getRec, metaGet, metaSet, put } from "./data";
import { computeDoc, nowIso, todayStr, uid } from "./calc";
import type { Customer, Doc, Expense } from "./types";

const isUpi = (e: Expense) => e.type === "sale" && e.mode === "upi";

const META_KEY = "payAccounts";
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PayAccount {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * An account holder (a person who receives UPI on the company's behalf, e.g. "Tabrez").
 * Groups one or more named sub-accounts. The money itself still lives on `expenses`
 * (UPI credits) and `collections` (hand-over debits), keyed by the sub-account *name* —
 * a holder is just a grouping layer over those names, so no transaction data ever moves.
 */
export interface PayHolder {
  id: string; // "HLD-" + uid
  name: string;
  accounts: string[]; // sub-account names belonging to this holder
  opening?: number; // opening balance already held by this person before tracking began (₹) — adds to the amount to collect
  createdAt: string;
  updatedAt: string;
  synced?: boolean;
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

// ─────────────────────────────────────────────────────────────────────────────
// "Clear log & start fresh" — a WATERMARK, never a delete. When the owner is
// satisfied an account/holder is fully settled, we store a timestamp; the
// Accounts page then hides everything at/before it and the running totals start
// again from zero. The underlying payments are untouched everywhere else
// (quotations, Statements, Balances, Daybook) and stay in the database forever.
// ─────────────────────────────────────────────────────────────────────────────

const CLEAR_KEY = "acctClearedAt";

export const holderClearKey = (holderId: string) => "holder:" + holderId;
export const acctClearKey = (name: string) => "acct:" + (name || "").trim().toLowerCase();
/** stashes the holder's opening balance at clear time, so Undo can restore it */
const openingStashKey = (holderId: string) => "opening:" + holderId;

export async function stashHolderOpening(holderId: string, opening: number): Promise<void> {
  const marks = await getClearMarks();
  await metaSet(CLEAR_KEY, { ...marks, [openingStashKey(holderId)]: String(opening) });
}

/** The opening balance stashed at clear time (0 if none), removed from the stash. */
export async function popHolderOpening(holderId: string): Promise<number> {
  const marks = await getClearMarks();
  const k = openingStashKey(holderId);
  const v = +(marks[k] || 0) || 0;
  if (k in marks) {
    const next = { ...marks };
    delete next[k];
    await metaSet(CLEAR_KEY, next);
  }
  return v;
}

export const getClearMarks = () => metaGet<Record<string, string>>(CLEAR_KEY, {});

/** Stamp a clear-mark (now) for a holder/account key. */
export async function markCleared(key: string): Promise<void> {
  const marks = await getClearMarks();
  await metaSet(CLEAR_KEY, { ...marks, [key]: nowIso() });
}

/** Undo a clear-mark — the full history shows again (nothing was ever deleted). */
export async function unmarkCleared(key: string): Promise<void> {
  const marks = await getClearMarks();
  if (!(key in marks)) return;
  const next = { ...marks };
  delete next[key];
  await metaSet(CLEAR_KEY, next);
}

/** An AcctBalance with only the lines AFTER the watermark, totals re-derived.
 *  Lines with no timestamp are treated as old history (hidden once cleared). */
export function balanceAfter(a: AcctBalance, cutIso?: string): AcctBalance {
  if (!cutIso) return a;
  const lines = a.lines.filter((l) => (l.at || "") > cutIso);
  let received = 0;
  let ownerReceived = 0;
  let collected = 0;
  for (const l of lines) {
    if (l.kind === "collect") {
      collected += l.amount;
    } else if (l.toOwner) {
      ownerReceived += l.amount;
    } else {
      received += l.amount;
      if (l.legacyCollected) collected += l.amount;
    }
  }
  return {
    name: a.name,
    received: r2(received),
    ownerReceived: r2(ownerReceived),
    collected: r2(collected),
    balance: r2(received - collected),
    lines,
  };
}

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

/** All known account names — holder sub-accounts + legacy registry + any used on past payments. */
export async function payAccounts(): Promise<string[]> {
  const [registry, holders, expenses] = await Promise.all([
    loadRegistry(),
    listHolders(),
    allRec<Expense>("expenses"),
  ]);
  const used = expenses.filter(isAccountPayment).map((e) => (e.account || "").trim()).filter(Boolean);
  const sub = holders.flatMap((h) => h.accounts);
  return [...new Set([...sub, ...registry.map((a) => a.name), ...used])].sort();
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

// ─────────────────────────────────────────────────────────────────────────────
// Account holders — a grouping layer over sub-account names (see PayHolder above).
// ─────────────────────────────────────────────────────────────────────────────

const normName = (s: string) => (s || "").trim();
const sameName = (a: string, b: string) => normName(a).toLowerCase() === normName(b).toLowerCase();

export const listHolders = () => allRec<PayHolder>("payHolders");

async function saveHolder(h: PayHolder): Promise<PayHolder> {
  h.updatedAt = nowIso();
  await put("payHolders", h);
  return h;
}

export async function addHolder(name: string): Promise<PayHolder | null> {
  const n = normName(name);
  if (!n) return null;
  const list = await listHolders();
  if (list.some((h) => sameName(h.name, n))) return null;
  const now = nowIso();
  return saveHolder({ id: "HLD-" + uid(), name: n, accounts: [], createdAt: now, updatedAt: now });
}

export async function renameHolder(id: string, name: string): Promise<PayHolder | null> {
  const n = normName(name);
  if (!n) return null;
  const list = await listHolders();
  if (list.some((h) => h.id !== id && sameName(h.name, n))) return null;
  const h = list.find((x) => x.id === id);
  if (!h) return null;
  h.name = n;
  return saveHolder(h);
}

/** Set a holder's opening balance (₹ already in their hands before tracking began). */
export async function setHolderOpening(id: string, amount: number): Promise<PayHolder | null> {
  const list = await listHolders();
  const h = list.find((x) => x.id === id);
  if (!h) return null;
  h.opening = Math.round((+amount || 0) * 100) / 100;
  return saveHolder(h);
}

/** Delete a holder. Its sub-accounts (and all their money) stay — they just become ungrouped. */
export async function removeHolder(id: string): Promise<void> {
  await delRec("payHolders", id);
}

/**
 * Attach a sub-account name to a holder. Creates the name if new; if the name already
 * lives under another holder it is *moved* here (a name maps to exactly one holder).
 */
export async function addHolderAccount(holderId: string, accName: string): Promise<PayHolder | null> {
  const n = normName(accName);
  if (!n) return null;
  const list = await listHolders();
  const target = list.find((h) => h.id === holderId);
  if (!target) return null;
  // remove the name from any other holder so it belongs to exactly one
  for (const h of list) {
    if (h.id === holderId) continue;
    const next = h.accounts.filter((a) => !sameName(a, n));
    if (next.length !== h.accounts.length) {
      h.accounts = next;
      await saveHolder(h);
    }
  }
  if (!target.accounts.some((a) => sameName(a, n))) target.accounts = [...target.accounts, n];
  return saveHolder(target);
}

/** Detach a sub-account name from a holder (money stays; the name becomes ungrouped). */
export async function removeHolderAccount(holderId: string, accName: string): Promise<PayHolder | null> {
  const list = await listHolders();
  const h = list.find((x) => x.id === holderId);
  if (!h) return null;
  h.accounts = h.accounts.filter((a) => !sameName(a, accName));
  return saveHolder(h);
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
    await put("expenses", e);
    total += +e.amount || 0;
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// UPI account balances + partial hand-overs (collections)
//
// Each UPI account is a little ledger: customer UPI payments credit it, and a
// "collection" (hand-over to the owner) debits it by any custom amount, leaving
// the rest as a running balance. Money that went straight to the owner
// (toOwner) is recorded but never counts toward the collectable balance.
// ─────────────────────────────────────────────────────────────────────────────

/** A partial hand-over of money (a debit). Keyed either to a holder (new: collect from the
 *  whole holder) or to a single account name (legacy / ungrouped accounts with no holder). */
export interface AccountCollection {
  id: string; // "COL-" + uid
  account: string; // account name (ungrouped) OR the holder name for display when holderId is set
  holderId?: string; // when set, this is a holder-level hand-over (not tied to one account)
  amount: number;
  date: string; // dd-mm-yy
  by: string; // enteredBy
  note?: string;
  /** true = cash went to Manager Daybook (linked expenseId); false/absent = Owner pocket */
  toManager?: boolean;
  /** Daybook sale row created when toManager — deleted with this collection */
  expenseId?: string;
  createdAt: string;
  updatedAt: string;
  synced?: boolean;
}

/** A UPI credit into an account (customer payment). */
const isUpiCredit = (e: Expense) => e.type === "sale" && !e.charge && e.mode === "upi" && !!(e.account || "").trim();

export const listCollections = () => allRec<AccountCollection>("collections");

export async function addCollection(fields: {
  account: string;
  holderId?: string;
  amount: number;
  date?: string;
  by: string;
  note?: string;
  toManager?: boolean;
  expenseId?: string;
}): Promise<AccountCollection | null> {
  const account = (fields.account || "").trim();
  const amount = r2(Math.max(0, +fields.amount || 0));
  if (!account || amount <= 0) return null;
  const now = nowIso();
  const c: AccountCollection = {
    id: "COL-" + uid(),
    account,
    holderId: fields.holderId || undefined,
    amount,
    date: fields.date || todayStr(),
    by: fields.by,
    note: (fields.note || "").trim(),
    toManager: fields.toManager || undefined,
    expenseId: fields.expenseId || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await put("collections", c);
  return c;
}

/** Move a UPI payment to a different account name (re-categorise, everywhere it shows). */
export async function moveEntryAccount(id: string, toAccount: string): Promise<boolean> {
  const n = normName(toAccount);
  if (!n) return false;
  const e = await getRec<Expense>("expenses", id);
  if (!e) return false;
  e.account = n;
  e.updatedAt = nowIso();
  await put("expenses", e);
  return true;
}

export async function deleteCollection(id: string): Promise<void> {
  const c = await getRec<AccountCollection>("collections", id);
  if (c?.expenseId) await delRec("expenses", c.expenseId);
  await delRec("collections", id);
}

/** Delete a UPI credit shown under an account. If it's a quote payment (sourceId), the amount is
 *  rolled back off that quotation's paid total so nothing desyncs; account receipts just delete. */
export async function deleteAccountEntry(id: string): Promise<void> {
  const e = await getRec<Expense>("expenses", id);
  if (!e) return;
  if (e.sourceId) {
    const q = await getRec<Doc>("quotations", e.sourceId);
    if (q) {
      const amt = +e.amount || 0;
      const payCash = r2(Math.max(0, (+(q.payCash || 0) || 0) - (e.mode === "cash" ? amt : 0)));
      const payUpi = r2(Math.max(0, (+(q.payUpi || 0) || 0) - (e.mode === "upi" ? amt : 0)));
      q.payCash = payCash;
      q.payUpi = payUpi;
      q.amountPaid = r2(payCash + payUpi);
      const fp = q.finalPrice != null && q.finalPrice > 0 ? q.finalPrice : computeDoc(q).grand;
      q.paymentStatus = q.amountPaid <= 0 ? "Pending" : q.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
      q.paidLogged = q.amountPaid > 0;
      q.updatedAt = nowIso();
      await put("quotations", q);
    }
  }
  await delRec("expenses", id);
}

export type AcctLineKind = "in" | "collect";
export interface AcctStmtLine {
  id: string;
  kind: AcctLineKind;
  amount: number;
  date: string;
  at: string;
  by: string;
  customer?: string;
  quoteNo?: string;
  /** the customer this credit was booked to when it came from the Receipts tab (no quote). */
  custId?: string;
  toOwner?: boolean;
  /** collect line: cash went to Manager Daybook */
  toManager?: boolean;
  note?: string;
  /** legacy per-entry collect flag (money already handed over under the old system). */
  legacyCollected?: boolean;
}

export interface AcctBalance {
  name: string;
  /** collectable UPI received (excludes to-owner). */
  received: number;
  /** UPI that went straight to the owner — recorded, not collectable. */
  ownerReceived: number;
  /** total handed over: new collections + legacy per-entry collected. */
  collected: number;
  /** received − collected. */
  balance: number;
  lines: AcctStmtLine[]; // newest first
}

export interface AcctLedger {
  accounts: AcctBalance[]; // most balance first
  totalReceived: number;
  totalOwner: number;
  totalCollected: number;
  totalBalance: number;
}

/** Per-UPI-account balances + a merged (credits + collections) statement, newest first. */
export function acctLedger(
  expenses: Expense[],
  collections: AccountCollection[],
  quotes: Doc[] = [],
  customers: Customer[] = [],
): AcctLedger {
  const map = new Map<string, AcctBalance>();
  const get = (name: string) => {
    let a = map.get(name);
    if (!a) {
      a = { name, received: 0, ownerReceived: 0, collected: 0, balance: 0, lines: [] };
      map.set(name, a);
    }
    return a;
  };

  for (const e of expenses) {
    if (!isUpiCredit(e)) continue;
    const name = (e.account || "").trim();
    const a = get(name);
    const amt = +e.amount || 0;
    const legacyCollected = !!e.collectedAt && !e.toOwner;
    if (e.toOwner) a.ownerReceived += amt;
    else {
      a.received += amt;
      if (legacyCollected) a.collected += amt;
    }
    a.lines.push({
      id: e.id,
      kind: "in",
      amount: amt,
      date: e.date,
      at: e.createdAt || "",
      by: e.enteredBy,
      customer: partyName(e, quotes, customers),
      quoteNo: quoteNo(e, quotes),
      custId: e.sourceId ? "" : e.custId || "",
      toOwner: !!e.toOwner,
      legacyCollected,
    });
  }

  for (const c of collections) {
    if (c.holderId) continue; // holder-level hand-over — handled per-holder, not per-account
    const name = (c.account || "").trim();
    if (!name) continue;
    const a = get(name);
    a.collected += +c.amount || 0;
    a.lines.push({
      id: c.id,
      kind: "collect",
      amount: +c.amount || 0,
      date: c.date,
      at: c.createdAt || "",
      by: c.by,
      note: c.note,
      toManager: !!c.toManager,
    });
  }

  const accounts = [...map.values()]
    .map((a) => ({
      ...a,
      received: r2(a.received),
      ownerReceived: r2(a.ownerReceived),
      collected: r2(a.collected),
      balance: r2(a.received - a.collected),
      lines: a.lines.sort((x, y) => (y.at || "").localeCompare(x.at || "")),
    }))
    .sort((a, b) => b.balance - a.balance || b.received - a.received);

  return {
    accounts,
    totalReceived: r2(accounts.reduce((s, a) => s + a.received, 0)),
    totalOwner: r2(accounts.reduce((s, a) => s + a.ownerReceived, 0)),
    totalCollected: r2(accounts.reduce((s, a) => s + a.collected, 0)),
    totalBalance: r2(accounts.reduce((s, a) => s + a.balance, 0)),
  };
}

export { todayStr };
