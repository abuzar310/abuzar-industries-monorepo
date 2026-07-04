import { allRec, delRec, put } from "./db";
import { nowIso, splitHandover, todayStr, uid } from "./calc";
import { cloudDelete, trySync } from "./cloud";
import type { DaybookSession, EntryType, Expense, PayMode } from "./types";

export const ENTRY_TYPES: { value: EntryType; label: string; flow: "in" | "out" }[] = [
  { value: "sale", label: "Sale (money in)", flow: "in" },
  { value: "salary", label: "Salary given", flow: "out" },
  { value: "food", label: "Food", flow: "out" },
  { value: "additional", label: "Additional cost", flow: "out" },
  { value: "custom", label: "Custom", flow: "out" },
];

export const typeLabel = (t: EntryType) => ENTRY_TYPES.find((e) => e.value === t)?.label ?? t;
export const isInflow = (t: EntryType) => ENTRY_TYPES.find((e) => e.value === t)?.flow === "in";
/** UPI money-in: kept OUT of the cash daybook (Ajju only owes cash) and shown in its own section. */
export const isUpi = (e: Expense) => isInflow(e.type) && e.mode === "upi";

export interface DayTotals {
  cashIn: number;
  upiIn: number;
  totalIn: number;
  spent: number;
  /** money in hand = totalIn − spent (the amount to hand over) */
  net: number;
  count: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function dayTotals(list: Expense[]): DayTotals {
  let cashIn = 0,
    upiIn = 0,
    spent = 0;
  for (const e of list) {
    const amt = +e.amount || 0;
    if (isInflow(e.type)) {
      if (e.mode === "upi") upiIn += amt;
      else cashIn += amt;
    } else {
      spent += amt;
    }
  }
  const totalIn = r2(cashIn + upiIn);
  return { cashIn: r2(cashIn), upiIn: r2(upiIn), totalIn, spent: r2(spent), net: r2(totalIn - spent), count: list.length };
}

export async function addExpense(fields: {
  type: EntryType;
  amount: number;
  mode: PayMode;
  note?: string;
  label?: string;
  account?: string;
  enteredBy: string;
  date?: string;
  sourceId?: string;
}): Promise<Expense> {
  const mode = isInflow(fields.type) ? fields.mode || "cash" : "";
  const e: Expense = {
    id: "EXP-" + uid(),
    date: fields.date || todayStr(),
    type: fields.type,
    label: fields.label || "",
    mode,
    amount: r2(fields.amount),
    note: fields.note || "",
    account: mode === "upi" ? (fields.account || "").trim() : "",
    enteredBy: fields.enteredBy,
    sourceId: fields.sourceId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    synced: false,
  };
  await put("expenses", e);
  trySync();
  return e;
}

export const allExpenses = () => allRec<Expense>("expenses");

/** Distinct UPI account names used so far (for the "to whom" quick-pick). */
export async function upiAccounts(): Promise<string[]> {
  const arr = await allExpenses();
  return [...new Set(arr.filter(isUpi).map((e) => (e.account || "").trim()).filter(Boolean))].sort();
}

/** Delete (locally + cloud) every daybook entry auto-created from a given doc. Returns the count removed. */
export async function deleteExpensesBySource(sourceId: string): Promise<number> {
  if (!sourceId) return 0;
  const linked = (await allExpenses()).filter((e) => e.sourceId === sourceId);
  for (const e of linked) {
    await delRec("expenses", e.id);
    cloudDelete("expenses", e.id);
  }
  return linked.length;
}

/** Entries in the current open session (not yet handed over). */
export const openExpenses = async () => (await allExpenses()).filter((e) => !e.sessionId);

export const allSessions = () => allRec<DaybookSession>("sessions");

/** Cash carried over from the most recent closed session — the current session's opening balance. */
export async function openingCarry(): Promise<number> {
  const prev = (await allSessions()).sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
  return r2(prev[0]?.carried || 0);
}

/** Close the current session: archive its entries and record the handover.
 *  `given` = cash actually handed over; the rest (in-hand − given) carries to the next session.
 *  Omit `given` to hand over everything. Returns the created session, or null if nothing to close. */
export async function closeSession(by: string, given?: number): Promise<DaybookSession | null> {
  // only the cash daybook is handed over; UPI entries stay out (Ajju owes cash only)
  const open = (await openExpenses()).filter((e) => !isUpi(e));
  const opening = await openingCarry();
  if (!open.length && opening <= 0) return null;
  const t = dayTotals(open);
  const { given: give, carried } = splitHandover(opening, t.net, given); // opening carry + (cash in − spent)
  const now = nowIso();
  const session: DaybookSession = {
    id: "SES-" + uid(),
    date: todayStr(),
    closedAt: now,
    cashIn: t.cashIn,
    upiIn: t.upiIn,
    totalIn: t.totalIn,
    spent: t.spent,
    opening,
    given: give,
    carried,
    count: t.count,
    by,
    createdAt: now,
    updatedAt: now,
    synced: false,
  };
  await put("sessions", session);
  // tag every open entry with this session so it leaves the current view
  for (const e of open) {
    e.sessionId = session.id;
    e.updatedAt = now;
    e.synced = false;
    await put("expenses", e);
  }
  trySync();
  return session;
}
