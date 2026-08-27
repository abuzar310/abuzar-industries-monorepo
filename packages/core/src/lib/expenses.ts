import { allRec, delRec, put } from "./data";
import { nowIso, splitHandover, todayStr, uid } from "./calc";
import type { DaybookSession, EntryType, Expense, PayMode } from "./types";
import { liveSpendCategories, SPEND_CATEGORIES, type SpendCategory } from "./book-catalog";

export type { SpendCategory };
export { SPEND_CATEGORIES, liveSpendCategories };

/** Money-in label: owner (or anyone) tops up manager cash — Daybook only, not Books. */
export const PAID_TO_MANAGER_LABEL = "Paid to manager";
export const PAID_TO_OWNER_LABEL = "Paid to owner";

function cats() {
  return liveSpendCategories({ hidden: true });
}

/** Old printed names that still map to a live category id. */
function catAlias(lab: string): string | undefined {
  if (lab === "Pigmy") return "pigmy";
  if (lab === "Truck rent") return "truck";
  return undefined;
}

function otherLabel() {
  return cats().find((c) => c.id === "other")?.label || "Other";
}

export function spendLabels(): Set<string> {
  const s = new Set(cats().map((c) => c.label));
  s.add("Pigmy");
  s.add("Truck rent");
  return s;
}

/** True when the row should appear in Books (income / spends / month ledger). */
export function inBooks(e: Expense): boolean {
  if (e.charge) return false;
  if (e.skipBooks) return false;
  const lab = (e.label || "").trim();
  if (lab === PAID_TO_MANAGER_LABEL) return false;
  const match = cats().find((c) => c.label === lab || c.id === catAlias(lab));
  if (match?.skipBooks) return false;
  return true;
}

/** Books / reports category bucket. Matches live names (renames stay on the same id). */
export function spendCategoryOf(e: Expense): string {
  if (e.type === "sale") {
    if (e.charge) return "Due";
    const lab = (e.label || "").trim();
    if (lab === PAID_TO_MANAGER_LABEL) return PAID_TO_MANAGER_LABEL;
    return "Sale";
  }
  if (e.type === "food") return cats().find((c) => c.id === "food")?.label || "Food";
  if (e.type === "salary") return cats().find((c) => c.id === "salary")?.label || "Salary";
  if (e.type === "custom") {
    const lab = (e.label || "").trim();
    const alias = catAlias(lab);
    if (alias) return cats().find((c) => c.id === alias)?.label || lab;
    const hit = cats().find((c) => c.label === lab);
    if (hit) return hit.label;
  }
  return otherLabel();
}

/** Stable group key for Books — category id (or sale/due). */
export function spendCatKey(e: Expense): string {
  if (e.type === "sale") return e.charge ? "due" : "sale";
  if (e.type === "food") return "food";
  if (e.type === "salary") return "salary";
  const lab = (e.label || "").trim();
  const alias = catAlias(lab);
  if (alias) return alias;
  return cats().find((c) => c.label === lab)?.id || "other";
}

/** Detail line for lists: party · carpenter · quote · rounds · note. */
export function spendDetailOf(e: Expense): string {
  const bits: string[] = [];
  const party = (e.party || "").trim();
  if (party) bits.push(party);
  const carpenter = (e.carpenter || "").trim();
  if (carpenter) bits.push("Carpenter " + carpenter);
  const qNo = (e.quoteNo || "").trim();
  if (qNo) bits.push("Q#" + qNo);
  const rounds = +(e.rounds || 0);
  if (rounds > 0) bits.push(rounds === 1 ? "1 round" : rounds + " rounds");
  const note = (e.note || "").trim();
  if (note) bits.push(note);
  if (bits.length) return bits.join(" · ");
  const lab = (e.label || "").trim();
  if (lab && !spendLabels().has(lab)) return lab;
  return "";
}

export const ENTRY_TYPES: { value: EntryType; label: string; flow: "in" | "out" }[] = [
  { value: "sale", label: "Sale (money in)", flow: "in" },
  { value: "salary", label: "Salary", flow: "out" },
  { value: "food", label: "Food", flow: "out" },
  // additional / custom kept for old rows — new UI uses SPEND_CATEGORIES instead
  { value: "additional", label: "Additional", flow: "out" },
  { value: "custom", label: "Other", flow: "out" },
];

export const typeLabel = (t: EntryType) => ENTRY_TYPES.find((e) => e.value === t)?.label ?? t;
/** Money-in is only `sale`. Everything else (food, salary, custom…) is money-out. */
export const isInflow = (t: EntryType) => t === "sale";
/** UPI money-in: kept OUT of the cash daybook (Manager only owes cash) and shown in its own section. */
export const isUpi = (e: Expense) => isInflow(e.type) && e.mode === "upi";
/** Quote payment settled as carpenter commission (wood, no cash). Has sourceId on the wood quote. */
export function isQuoteCommissionPay(e: Expense): boolean {
  if (e.type === "sale" || e.charge) return false;
  return spendCatKey(e) === "carpenter" && !!e.sourceId;
}

/** Does this entry belong in the manager's cash daybook? Excludes UPI, cash sent straight to owner,
 *  cash assigned to a named account, customer dues/charges, and wood-against-commission. */
/** Place-rent set-off: commission given without cash — not till money. */
export function isPlaceRentSetoff(e: Expense): boolean {
  return e.placeRentKind === "setoff";
}

export const inDaybook = (e: Expense) =>
  !isUpi(e) &&
  !e.toOwner &&
  !e.charge &&
  !isPlaceRentSetoff(e) &&
  !(e.mode === "cash" && !!(e.account || "").trim()) &&
  !isQuoteCommissionPay(e);

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
  party?: string;
  rounds?: number;
  carpenter?: string;
  carpenterId?: string;
  placeRentKind?: "charge" | "opening" | "received" | "setoff";
  refQuoteId?: string;
  quoteNo?: string;
  account?: string;
  /** transfer counter-account (journal voucher's TO-bank) */
  account2?: string;
  toOwner?: boolean;
  /** Daybook-only internal move — omitted from Books */
  skipBooks?: boolean;
  enteredBy: string;
  date?: string;
  sourceId?: string;
  custId?: string;
  charge?: boolean;
  /** groups the pieces of one split customer receipt (see receipts.ts) */
  rcptId?: string;
}): Promise<Expense> {
  const mode = fields.charge ? "" : isInflow(fields.type) ? fields.mode || "cash" : "";
  const rounds = Math.max(0, Math.floor(+(fields.rounds || 0) || 0));
  const label = (fields.label || "").trim();
  const skipBooks =
    !!fields.skipBooks ||
    label === PAID_TO_OWNER_LABEL ||
    label === PAID_TO_MANAGER_LABEL;
  const e: Expense = {
    id: "EXP-" + uid(),
    date: fields.date || todayStr(),
    type: fields.type,
    label: label || "",
    mode,
    amount: r2(fields.amount),
    note: fields.note || "",
    party: (fields.party || "").trim() || undefined,
    rounds: rounds > 0 ? rounds : undefined,
    carpenter: (fields.carpenter || "").trim() || undefined,
    carpenterId: (fields.carpenterId || "").trim() || undefined,
    placeRentKind: fields.placeRentKind || undefined,
    refQuoteId: (fields.refQuoteId || "").trim() || undefined,
    quoteNo: (fields.quoteNo || "").trim() || undefined,
    account: (fields.account || "").trim(),
    account2: (fields.account2 || "").trim() || undefined,
    // outflows (mode "") can also be owner-paid — e.g. the owner hands a worker money
    // from his own pocket; inDaybook() then keeps it out of the manager's cash book.
    toOwner: mode === "cash" || mode === "" ? !!fields.toOwner : false,
    skipBooks: skipBooks || undefined,
    enteredBy: fields.enteredBy,
    sourceId: fields.sourceId,
    custId: fields.custId,
    rcptId: fields.rcptId,
    charge: !!fields.charge,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await put("expenses", e);
  return e;
}

export const allExpenses = () => allRec<Expense>("expenses");

/** Distinct account names used so far (for the quick-pick). Re-exported from accounts.ts. */
export { payAccounts as upiAccounts } from "./accounts";

/** Delete (locally + cloud) every daybook entry auto-created from a given doc. Returns the count removed. */
export async function deleteExpensesBySource(sourceId: string): Promise<number> {
  if (!sourceId) return 0;
  const linked = (await allExpenses()).filter((e) => e.sourceId === sourceId);
  for (const e of linked) await delRec("expenses", e.id);
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
  };
  await put("sessions", session);
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
    await put("expenses", e);
  }
  ses.pending = false;
  ses.confirmedBy = by;
  ses.updatedAt = now;
  await put("sessions", ses);
  return true;
}

/** Cancel a pending handover (owner declines or the manager withdraws) — nothing was archived. */
export async function declineHandover(id: string): Promise<void> {
  await delRec("sessions", id);
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
  for (const e of entries) await delRec("expenses", e.id);
  await delRec("sessions", id);
}
