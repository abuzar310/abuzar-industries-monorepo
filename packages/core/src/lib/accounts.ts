// Named payment accounts (UPI + cash held by Tabrez, Afsar, etc.) — registry + rollup + daily collect.
import { allRec, delRec, getRec, metaGet, metaSet, put } from "./data";
import { nowIso, todayStr, uid } from "./calc";
import { quoteBill, quotePaid } from "./payments";
import {
  COLLECT_CASH,
  COLLECT_UPI,
  isAccountTransportPay,
  isPendingTransport,
  isTransportPocketName,
  TRANSPORT_LABEL,
  transportPlaceOf,
} from "./pocket-spend";
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
  /** transport = Pay transport is the main action; collect = Collect stays first (overrides a "transport" in the name). */
  kind?: "transport" | "collect";
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
  let spent = 0;
  for (const l of lines) {
    if (l.kind === "collect") {
      collected += l.amount;
    } else if (l.kind === "transport") {
      spent += l.amount;
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
    spent: r2(spent),
    balance: r2(received - collected - spent),
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

export async function addHolder(name: string, kind?: PayHolder["kind"]): Promise<PayHolder | null> {
  const n = normName(name);
  if (!n) return null;
  const list = await listHolders();
  if (list.some((h) => sameName(h.name, n))) return null;
  const now = nowIso();
  const inferred = kind ?? (isTransportPocketName(n) ? "transport" : undefined);
  return saveHolder({ id: "HLD-" + uid(), name: n, accounts: [], kind: inferred, createdAt: now, updatedAt: now });
}

export async function setHolderKind(id: string, kind?: PayHolder["kind"]): Promise<PayHolder | null> {
  const h = (await listHolders()).find((x) => x.id === id);
  if (!h) return null;
  if (kind) h.kind = kind;
  else delete h.kind;
  return saveHolder(h);
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

export {
  isAccountTransportPay,
  isPendingTransport,
  isTransportPocketName,
  TRANSPORT_LABEL,
  transportDueLabel,
  transportNeedToCollect,
  dueOnTransportPocket,
  transportPlaceOf,
  COLLECT_CASH,
  COLLECT_UPI,
  isHandCollectOn,
  collectOnLabel,
  collectOnOptions,
} from "./pocket-spend";

/** Pay transport is the main button on this pocket (name heuristic, unless kind overrides). */
export function isTransportPocket(
  h?: Pick<PayHolder, "kind" | "name" | "accounts">,
  accountName?: string,
): boolean {
  if (h?.kind === "transport") return true;
  if (h?.kind === "collect") return false;
  return isTransportPocketName(h?.name, ...(h?.accounts ?? []), accountName);
}

export function stmtFromTransport(e: Expense): AcctStmtLine {
  const veh = (e.vehicleNo || "").trim();
  const from = transportPlaceOf(e);
  const note = [veh, from ? "from " + from : "", (e.note || "").trim()].filter(Boolean).join(" · ");
  return {
    id: e.id,
    kind: "transport",
    amount: +e.amount || 0,
    date: e.date,
    at: e.createdAt || "",
    by: e.enteredBy,
    customer: (e.party || "").trim() || undefined,
    note: note || undefined,
  };
}

/** Lock a lorry bill. Not in Books and does not drop a UPI pocket until settleTransportDue. */
export async function addTransportDue(fields: {
  party: string;
  amount: number;
  boughtFrom?: string;
  placeOfSupply?: string;
  vehicleNo?: string;
  /** Holder id or UPI name this due is collected against (CS Kumar). */
  transportPocket?: string;
  date?: string;
  by: string;
  note?: string;
}): Promise<Expense | null> {
  const party = (fields.party || "").trim();
  const amount = r2(Math.max(0, +fields.amount || 0));
  if (!party || amount <= 0) return null;
  const now = nowIso();
  const place = (fields.placeOfSupply || fields.boughtFrom || "").trim();
  const vehicle = (fields.vehicleNo || "").trim();
  const e: Expense = {
    id: "EXP-" + uid(),
    date: fields.date || todayStr(),
    type: "custom",
    label: TRANSPORT_LABEL,
    mode: "",
    amount,
    note: (fields.note || "").trim(),
    party,
    boughtFrom: place || undefined,
    placeOfSupply: place || undefined,
    vehicleNo: vehicle || undefined,
    transportPocket: (fields.transportPocket || "").trim() || undefined,
    pocketSpend: "transport",
    enteredBy: fields.by,
    createdAt: now,
    updatedAt: now,
  };
  await put("expenses", e);
  return e;
}

export type TransportDuePatch = {
  party?: string;
  amount?: number;
  vehicleNo?: string;
  placeOfSupply?: string;
  transportPocket?: string;
  date?: string;
  note?: string;
};

/** Locked due only — paid rows stay frozen. */
export function patchTransportDue(e: Expense, fields: TransportDuePatch): Expense | null {
  if (!isPendingTransport(e)) return null;
  const party = (fields.party !== undefined ? fields.party : e.party || "").trim();
  const amount = r2(Math.max(0, +(fields.amount !== undefined ? fields.amount : e.amount) || 0));
  if (!party || amount <= 0) return null;
  const place = (fields.placeOfSupply !== undefined ? fields.placeOfSupply : e.placeOfSupply || e.boughtFrom || "").trim();
  const vehicle = (fields.vehicleNo !== undefined ? fields.vehicleNo : e.vehicleNo || "").trim();
  const pocket = (fields.transportPocket !== undefined ? fields.transportPocket : e.transportPocket || "").trim();
  return {
    ...e,
    party,
    amount,
    vehicleNo: vehicle || undefined,
    boughtFrom: place || undefined,
    placeOfSupply: place || undefined,
    transportPocket: pocket || undefined,
    date: fields.date !== undefined ? fields.date || e.date : e.date,
    note: fields.note !== undefined ? (fields.note || "").trim() : e.note,
  };
}

export async function updateTransportDue(fields: TransportDuePatch & { id: string }): Promise<Expense | null> {
  const e = await getRec<Expense>("expenses", fields.id);
  if (!e) return null;
  const next = patchTransportDue(e, fields);
  if (!next) return null;
  next.updatedAt = nowIso();
  await put("expenses", next);
  return next;
}

export type TransportPaySource = {
  holderId?: string;
  account: string;
  balance: number;
  transport: boolean;
  /** Manager Daybook cash — till goes down. */
  cash?: boolean;
  /** Owner cash in hand — Daybook stays, Books still gets Transport. */
  ownerCash?: boolean;
  /** Owner's own UPI — Books yes, Daybook no, no pocket drop. */
  ownerUpi?: boolean;
};

export function isCsKumarPocketName(name?: string): boolean {
  return /cs\s*kumar/i.test(name || "");
}

export const CASH_TRANSPORT_SRC: TransportPaySource = {
  account: "Cash by manager",
  balance: 0,
  transport: false,
  cash: true,
};

export const OWNER_CASH_TRANSPORT_SRC: TransportPaySource = {
  account: "Cash by owner",
  balance: 0,
  transport: false,
  ownerCash: true,
};

export const OWNER_UPI_TRANSPORT_SRC: TransportPaySource = {
  account: "UPI by owner",
  balance: 0,
  transport: false,
  ownerUpi: true,
};

export function isHandTransportSrc(s: TransportPaySource): boolean {
  return !!(s.cash || s.ownerCash || s.ownerUpi);
}

export function paySrcKey(s: TransportPaySource): string {
  if (s.cash) return "cash";
  if (s.ownerCash) return "owner-cash";
  if (s.ownerUpi) return "owner-upi";
  return (s.holderId || "") + ":" + nameKey(s.account);
}

const nameKey = (s: string) => (s || "").trim().toLowerCase();

/** Holder opening + UPI in − collects − transport pays (same math as Accounts tiles). */
export function holderPayBalance(
  h: PayHolder,
  accounts: AcctBalance[],
  collections: AccountCollection[],
  expenses: Expense[],
): number {
  const byName = new Map(accounts.map((a) => [nameKey(a.name), a]));
  const subs = h.accounts.map((n) => byName.get(nameKey(n))).filter(Boolean) as AcctBalance[];
  const opening = r2(h.opening || 0);
  const received = r2(subs.reduce((s, a) => s + a.received, 0));
  const subCollected = r2(subs.reduce((s, a) => s + a.collected, 0));
  const cols = collections.filter((c) => c.holderId === h.id);
  const pays = expenses.filter((e) => isAccountTransportPay(e) && e.holderId === h.id);
  const collected = r2(subCollected + cols.reduce((s, c) => s + (+c.amount || 0), 0));
  const spent = r2(subs.reduce((s, a) => s + (a.spent || 0), 0) + pays.reduce((s, e) => s + (+e.amount || 0), 0));
  return r2(opening + received - collected - spent);
}

export function listTransportPaySources(
  holders: PayHolder[],
  accounts: AcctBalance[],
  collections: AccountCollection[],
  expenses: Expense[],
): TransportPaySource[] {
  const grouped = new Set<string>();
  holders.forEach((h) => h.accounts.forEach((n) => grouped.add(nameKey(n))));
  const srcs: TransportPaySource[] = [
    ...holders.map((h) => ({
      holderId: h.id as string | undefined,
      account: h.name,
      balance: holderPayBalance(h, accounts, collections, expenses),
      transport: isTransportPocket(h),
    })),
    ...accounts
      .filter((a) => !grouped.has(nameKey(a.name)))
      .map((a) => ({
        holderId: undefined as string | undefined,
        account: a.name,
        balance: a.balance,
        transport: isTransportPocket(undefined, a.name),
      })),
  ];
  srcs.sort((a, b) => Number(b.transport) - Number(a.transport) || b.balance - a.balance);
  return srcs;
}

/** Accounts Pay chips: the three hand pots, then UPI pockets. */
export function accountsTransportPaySources(pockets: TransportPaySource[]): TransportPaySource[] {
  return [CASH_TRANSPORT_SRC, OWNER_CASH_TRANSPORT_SRC, OWNER_UPI_TRANSPORT_SRC, ...pockets];
}

export function pickTransportPaySource(srcs: TransportPaySource[], amount: number): TransportPaySource | undefined {
  const cash = srcs.find((s) => s.cash);
  const cs = srcs.find((s) => isCsKumarPocketName(s.account));
  if (cs && cs.balance + 0.5 >= amount) return cs;
  if (cash) return cash;
  return (
    srcs.find((s) => s.transport && s.balance + 0.5 >= amount) ||
    srcs.find((s) => !isHandTransportSrc(s) && s.balance + 0.5 >= amount) ||
    srcs.find((s) => s.transport) ||
    srcs.find((s) => s.cash) ||
    srcs[0]
  );
}

/** Pay chips start on the Collect on pick; owner/manager cash can still be changed. */
export function pickPaySourceForCollectOn(
  srcs: TransportPaySource[],
  collectOn: string | undefined,
  amount: number,
): TransportPaySource | undefined {
  const p = (collectOn || "").trim().toLowerCase();
  if (p === COLLECT_CASH) return srcs.find((s) => s.cash) || srcs.find((s) => s.ownerCash);
  if (p === COLLECT_UPI) return srcs.find((s) => s.ownerUpi);
  if (p) {
    const hit = srcs.find((s) => nameKey(s.holderId || "") === p || nameKey(s.account) === p);
    if (hit) return hit;
  }
  return pickTransportPaySource(srcs, amount);
}

/** Receipts / Accounts: cash by manager, cash by owner, UPI by owner, then CS Kumar. */
export function receiptsTransportPaySources(srcs: TransportPaySource[]): TransportPaySource[] {
  return [
    CASH_TRANSPORT_SRC,
    OWNER_CASH_TRANSPORT_SRC,
    OWNER_UPI_TRANSPORT_SRC,
    ...srcs.filter((s) => isCsKumarPocketName(s.account)),
  ];
}

/** Tabrez / Mubeen / leftover UPI — hidden until added from Accounts. */
export function extraReceiptsTransportSources(srcs: TransportPaySource[]): TransportPaySource[] {
  return srcs.filter((s) => !isHandTransportSrc(s) && !isCsKumarPocketName(s.account));
}

/** Pay a locked due from Daybook cash — not a UPI pocket. */
export function applyTransportDueCash(e: Expense): Expense | null {
  if (!isPendingTransport(e)) return null;
  return { ...e, mode: "cash", toOwner: false, account: "", holderId: undefined, pocketSpend: undefined };
}

/** Owner paid the lorry from cash in hand — Books, not till, not a shop pocket. */
export function applyTransportDueOwnerCash(e: Expense): Expense | null {
  if (!isPendingTransport(e)) return null;
  return { ...e, mode: "cash", toOwner: true, account: "", holderId: undefined, pocketSpend: undefined };
}

/** Owner paid the lorry from personal UPI — Books, not till, not a shop pocket. */
export function applyTransportDueOwnerUpi(e: Expense): Expense | null {
  if (!isPendingTransport(e)) return null;
  return { ...e, mode: "upi", toOwner: true, account: "", holderId: undefined, pocketSpend: undefined };
}

export function selectedTransportDueTotal(dues: Pick<Expense, "amount">[]): number {
  return r2(dues.reduce((s, e) => s + (+e.amount || 0), 0));
}

/** Pay a locked transport due from a UPI pocket. Books + pocket drop happen here. */
export async function settleTransportDue(fields: {
  id: string;
  account: string;
  holderId?: string;
  date?: string;
  by: string;
}): Promise<Expense | null> {
  const account = (fields.account || "").trim();
  if (!account) return null;
  const e = await getRec<Expense>("expenses", fields.id);
  if (!e || !isPendingTransport(e)) return null;
  e.account = account;
  e.holderId = fields.holderId || undefined;
  e.date = fields.date || todayStr();
  e.enteredBy = fields.by || e.enteredBy;
  e.updatedAt = nowIso();
  await put("expenses", e);
  return e;
}

export async function settleTransportDueCash(fields: {
  id: string;
  date?: string;
  by: string;
}): Promise<Expense | null> {
  const e = await getRec<Expense>("expenses", fields.id);
  if (!e) return null;
  const next = applyTransportDueCash(e);
  if (!next) return null;
  next.date = fields.date || todayStr();
  next.enteredBy = fields.by || e.enteredBy;
  next.updatedAt = nowIso();
  await put("expenses", next);
  return next;
}

export async function settleTransportDueOwnerUpi(fields: {
  id: string;
  date?: string;
  by: string;
}): Promise<Expense | null> {
  const e = await getRec<Expense>("expenses", fields.id);
  if (!e) return null;
  const next = applyTransportDueOwnerUpi(e);
  if (!next) return null;
  next.date = fields.date || todayStr();
  next.enteredBy = fields.by || e.enteredBy;
  next.updatedAt = nowIso();
  await put("expenses", next);
  return next;
}

export async function settleTransportDueOwnerCash(fields: {
  id: string;
  date?: string;
  by: string;
}): Promise<Expense | null> {
  const e = await getRec<Expense>("expenses", fields.id);
  if (!e) return null;
  const next = applyTransportDueOwnerCash(e);
  if (!next) return null;
  next.date = fields.date || todayStr();
  next.enteredBy = fields.by || e.enteredBy;
  next.updatedAt = nowIso();
  await put("expenses", next);
  return next;
}

/** Same pay for several locked dues (Receipts Paid out → Transport). */
export async function settleTransportDues(fields: {
  ids: string[];
  account: string;
  holderId?: string;
  cash?: boolean;
  ownerCash?: boolean;
  ownerUpi?: boolean;
  date?: string;
  by: string;
}): Promise<Expense[]> {
  const out: Expense[] = [];
  for (const id of fields.ids) {
    const e = fields.ownerCash
      ? await settleTransportDueOwnerCash({ id, date: fields.date, by: fields.by })
      : fields.cash
        ? await settleTransportDueCash({ id, date: fields.date, by: fields.by })
        : fields.ownerUpi
          ? await settleTransportDueOwnerUpi({ id, date: fields.date, by: fields.by })
          : await settleTransportDue({ ...fields, id });
    if (e) out.push(e);
  }
  return out;
}

export async function addPayTransport(fields: {
  account: string;
  holderId?: string;
  amount: number;
  party: string;
  date?: string;
  by: string;
  note?: string;
  boughtFrom?: string;
  placeOfSupply?: string;
  vehicleNo?: string;
}): Promise<Expense | null> {
  const due = await addTransportDue(fields);
  if (!due) return null;
  return settleTransportDue({
    id: due.id,
    account: fields.account,
    holderId: fields.holderId,
    date: fields.date,
    by: fields.by,
  });
}

/** Delete a UPI credit shown under an account. If it's a quote payment (sourceId), the amount is
 *  rolled back off that quotation's paid total so nothing desyncs; account receipts just delete. */
export async function deleteAccountEntry(id: string): Promise<void> {
  const e = await getRec<Expense>("expenses", id);
  if (!e) return;
  const { restoreAdvanceFromApply } = await import("./vouchers");
  await restoreAdvanceFromApply(e);
  if (e.sourceId) {
    const q = await getRec<Doc>("quotations", e.sourceId);
    if (q) {
      const amt = +e.amount || 0;
      if (e.type !== "sale" && !e.charge && e.sourceId) {
        q.payCommission = r2(Math.max(0, (+(q.payCommission || 0) || 0) - amt));
      } else {
        q.payCash = r2(Math.max(0, (+(q.payCash || 0) || 0) - (e.mode === "cash" ? amt : 0)));
        q.payUpi = r2(Math.max(0, (+(q.payUpi || 0) || 0) - (e.mode === "upi" ? amt : 0)));
      }
      q.amountPaid = quotePaid(q);
      const fp = quoteBill(q);
      q.paymentStatus = q.amountPaid <= 0 ? "Pending" : q.amountPaid + 0.001 >= fp ? "Paid" : "Partial";
      q.paidLogged = q.amountPaid > 0;
      q.updatedAt = nowIso();
      await put("quotations", q);
    }
  }
  await delRec("expenses", id);
}

export type AcctLineKind = "in" | "collect" | "transport";
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
  /** paid from this pocket as transport (Books expense, not an owner hand-over). */
  spent: number;
  /** received − collected − spent. */
  balance: number;
  lines: AcctStmtLine[]; // newest first
}

export interface AcctLedger {
  accounts: AcctBalance[]; // most balance first
  totalReceived: number;
  totalOwner: number;
  totalCollected: number;
  totalSpent: number;
  totalBalance: number;
}

export function stmtFromCollection(c: AccountCollection): AcctStmtLine {
  return {
    id: c.id,
    kind: "collect",
    amount: +c.amount || 0,
    date: c.date,
    at: c.createdAt || "",
    by: c.by,
    note: c.note,
    toManager: !!c.toManager,
  };
}

const passbookDayKey = (d: string) => {
  const [dd, mm, yy] = (d || "").split("-");
  return dd && mm && yy ? `20${yy}-${mm}-${dd}` : "";
};

/** Oldest first: printed date, then createdAt (clock time). */
export function sortPassbookLines(lines: AcctStmtLine[]): AcctStmtLine[] {
  return lines.slice().sort((a, b) => {
    const da = passbookDayKey(a.date).localeCompare(passbookDayKey(b.date));
    if (da !== 0) return da;
    return (a.at || "").localeCompare(b.at || "");
  });
}

/** One holder passbook: every sub-account UPI line + holder-level hand-overs + holder-level transport. */
export function holderPassbookLines(
  subs: AcctBalance[],
  cols: AccountCollection[],
  transports: Expense[] = [],
): AcctStmtLine[] {
  const multi = subs.length > 1;
  const lines: AcctStmtLine[] = [];
  for (const a of subs) {
    for (const l of a.lines) {
      lines.push(
        multi && l.kind !== "collect" ? { ...l, customer: (l.customer || "—") + " · " + a.name } : l,
      );
    }
  }
  for (const c of cols) lines.push(stmtFromCollection(c));
  for (const e of transports) {
    if (!isAccountTransportPay(e) || !e.holderId) continue;
    lines.push(stmtFromTransport(e));
  }
  return lines;
}

/** Opening + UPI in − collects. After a collect, later lines continue from the new balance. */
export function passbookRunning(
  lines: AcctStmtLine[],
  opening = 0,
): { closing: number; after: { id: string; balance: number }[] } {
  let bal = opening;
  const after: { id: string; balance: number }[] = [];
  for (const l of sortPassbookLines(lines)) {
    bal = r2(bal + (l.kind === "in" ? l.amount : -l.amount));
    after.push({ id: l.id, balance: bal });
  }
  return { closing: r2(bal), after };
}

/** Every To/debit line is a fold. Click it to see only the stretch since the previous To. */
export function settleFoldIndexes(
  rows: { debit?: number; kind?: string; isOpen?: boolean; isClose?: boolean }[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.isOpen || r.isClose) continue;
    if (+(r.debit || 0) > 0 || r.kind === "collect" || r.kind === "transport") out.push(i);
  }
  return out;
}

/** Rows that belong to one To fold: after the previous settle, before this To. */
export function settleFoldChildren(folds: number[], foldAt: number): number[] {
  const k = folds.indexOf(foldAt);
  if (k < 0) return [];
  const start = (k > 0 ? folds[k - 1] : -1) + 1;
  const kids: number[] = [];
  for (let i = start; i < foldAt; i++) kids.push(i);
  return kids;
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
      a = { name, received: 0, ownerReceived: 0, collected: 0, spent: 0, balance: 0, lines: [] };
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

  for (const e of expenses) {
    if (!isAccountTransportPay(e) || e.holderId) continue; // holder-level — handled per-holder
    const name = (e.account || "").trim();
    if (!name) continue;
    const a = get(name);
    const amt = +e.amount || 0;
    a.spent += amt;
    a.lines.push(stmtFromTransport(e));
  }

  const accounts = [...map.values()]
    .map((a) => ({
      ...a,
      received: r2(a.received),
      ownerReceived: r2(a.ownerReceived),
      collected: r2(a.collected),
      spent: r2(a.spent),
      balance: r2(a.received - a.collected - a.spent),
      lines: a.lines.sort((x, y) => (y.at || "").localeCompare(x.at || "")),
    }))
    .sort((a, b) => b.balance - a.balance || b.received - a.received);

  return {
    accounts,
    totalReceived: r2(accounts.reduce((s, a) => s + a.received, 0)),
    totalOwner: r2(accounts.reduce((s, a) => s + a.ownerReceived, 0)),
    totalCollected: r2(accounts.reduce((s, a) => s + a.collected, 0)),
    totalSpent: r2(accounts.reduce((s, a) => s + a.spent, 0)),
    totalBalance: r2(accounts.reduce((s, a) => s + a.balance, 0)),
  };
}

export { todayStr };
