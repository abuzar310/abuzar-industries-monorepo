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
/** UPI money-in: kept OUT of the cash daybook (Manager only owes cash) and shown in its own section. */
export const isUpi = (e: Expense) => isInflow(e.type) && e.mode === "upi";
/** Does this entry belong in the manager's cash daybook? Excludes UPI, cash sent straight to owner,
 *  cash assigned to a named account, and customer dues/charges (a charge moves no cash). */
export const inDaybook = (e: Expense) =>
  !isUpi(e) && !e.toOwner && !e.charge && !(e.mode === "cash" && !!(e.account || "").trim());

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
  toOwner?: boolean;
  enteredBy: string;
  date?: string;
  sourceId?: string;
  custId?: string;
  charge?: boolean;
}): Promise<Expense> {
  const mode = fields.charge ? "" : isInflow(fields.type) ? fields.mode || "cash" : "";
  const e: Expense = {
    id: "EXP-" + uid(),
    date: fields.date || todayStr(),
    type: fields.type,
    label: fields.label || "",
    mode,
    amount: r2(fields.amount),
    note: fields.note || "",
    account: (fields.account || "").trim(),
    toOwner: mode === "cash" ? !!fields.toOwner : false,
    enteredBy: fields.enteredBy,
    sourceId: fields.sourceId,
    custId: fields.custId,
    charge: !!fields.charge,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    synced: false,
  };
  await put("expenses", e);
  trySync();
  return e;
}

export const allExpenses = () => allRec<Expense>("expenses");

/** Distinct account names used so far (for the quick-pick). Re-exported from accounts.ts. */
export { payAccounts as upiAccounts } from "./accounts";

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

/** Only finalised (owner-confirmed) sessions, newest first — pending requests are excluded. */
const confirmedSessions = async () =>
  (await allSessions()).filter((s) => !s.pending).sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));

/** Cash carried over from the most recent confirmed session — the current session's opening balance. */
export async function openingCarry(): Promise<number> {
  const prev = await confirmedSessions();
  return r2(prev[0]?.carried || 0);
}

/** The handover currently awaiting the owner's confirmation, if any. */
export async function pendingHandover(): Promise<DaybookSession | null> {
  return (await allSessions()).find((s) => s.pending) || null;
}

/** Manager requests a handover: snapshot this session and record how much is being given, but
 *  DON'T archive the entries yet — it only "takes off" once the owner confirms. Returns the
 *  pending session, or null if there's nothing to hand over. */
export async function requestHandover(by: string, given?: number): Promise<DaybookSession | null> {
  const now = nowIso();
  const prevClose = (await confirmedSessions())[0]?.closedAt || "";
  // this session's window = everything recorded since the last confirmed close
  const win = (await allExpenses()).filter((e) => {
    const at = e.createdAt || "";
    return !!at && at <= now && (!prevClose || at > prevClose);
  });
  const opening = await openingCarry();
  const cashSide = win.filter(inDaybook); // manager's cash-in + spends (excludes UPI + cash-to-owner)
  if (!cashSide.length && opening <= 0) return null;
  const wt = dayTotals(win); // includes UPI (for the upiIn line)
  const ct = dayTotals(cashSide); // manager's cash only — drives the handover
  const { given: give, carried } = splitHandover(opening, ct.net, given);
  const session: DaybookSession = {
    id: "SES-" + uid(),
    date: todayStr(),
    closedAt: now,
    cashIn: ct.cashIn,
    upiIn: wt.upiIn,
    totalIn: r2(ct.cashIn + wt.upiIn), // cash-to-owner is not the manager's money, so it's left out
    spent: ct.spent,
    opening,
    given: give,
    carried,
    count: cashSide.length,
    by,
    pending: true,
    createdAt: now,
    updatedAt: now,
    synced: false,
  };
  await put("sessions", session);
  trySync();
  return session;
}

/** Owner confirms a pending handover: archive its cash entries and finalise it ("it takes off"). */
export async function confirmHandover(id: string, by: string): Promise<boolean> {
  const ses = (await allSessions()).find((s) => s.id === id);
  if (!ses || !ses.pending) return false;
  const now = nowIso();
  // tag the manager's cash entries that were open at request time; later entries stay open for the next session
  const openCash = (await openExpenses()).filter((e) => inDaybook(e) && (e.createdAt || "") <= ses.closedAt);
  for (const e of openCash) {
    e.sessionId = ses.id;
    e.updatedAt = now;
    e.synced = false;
    await put("expenses", e);
  }
  ses.pending = false;
  ses.confirmedBy = by;
  ses.updatedAt = now;
  ses.synced = false;
  await put("sessions", ses);
  trySync();
  return true;
}

/** Cancel a pending handover (owner declines or the manager withdraws) — nothing was archived. */
export async function declineHandover(id: string): Promise<void> {
  await delRec("sessions", id);
  cloudDelete("sessions", id);
  trySync();
}

/** Delete a confirmed session record AND every entry it archived (its (prevClose, thisClose] window —
 *  the same set the history card lists). Owner-only. Carry-forward on later sessions is a stored
 *  snapshot and is left as-is. */
export async function deleteSession(id: string): Promise<void> {
  const asc = (await confirmedSessions()).sort((a, b) => (a.closedAt || "").localeCompare(b.closedAt || ""));
  const i = asc.findIndex((s) => s.id === id);
  if (i < 0) return;
  const from = i > 0 ? asc[i - 1].closedAt || "" : "";
  const to = asc[i].closedAt || "";
  const entries = (await allExpenses()).filter((e) => {
    const at = e.createdAt || "";
    return !!at && at <= to && (!from || at > from);
  });
  for (const e of entries) {
    await delRec("expenses", e.id);
    cloudDelete("expenses", e.id);
  }
  await delRec("sessions", id);
  cloudDelete("sessions", id);
  trySync();
}
