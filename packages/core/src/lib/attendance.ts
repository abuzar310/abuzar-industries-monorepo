// Worker wage register (weekly, MON → SUN). Attendance marks live in their own
// store; the MONEY (wages, debt loans, deductions, repayments) lives ONLY in the
// daybook as expenses tagged by sourceId prefix — never duplicated here.
import { allRec, delRec, getRec, metaGet, metaSet, put } from "./data";
import { dateSortKey, nowIso, pad, uid } from "./calc";
import { addExpense } from "./expenses";
import type { Expense } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Worker {
  id: string; // "WKR-" + uid
  name: string;
  /** daily wage ₹ */
  rate: number;
  /** Debt-account opening ₹ (rarely used) — a loan the worker already owed when the register started. */
  opening?: number;
  /** false = removed from the register (history stays; can be reactivated). */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceMark {
  /** `${workerId}|${iso}` — deterministic, so re-marking a day upserts, never duplicates. */
  id: string;
  workerId: string;
  /** yyyy-mm-dd */
  date: string;
  /** 1 = full day · 0.5 = half · 0 = absent */
  present: number;
  createdAt: string;
  updatedAt: string;
}

export const markId = (workerId: string, iso: string) => workerId + "|" + iso;

// ---- workers ----

export const listWorkers = () => allRec<Worker>("workers");

export async function saveWorker(fields: { id?: string; name: string; rate: number; opening?: number }): Promise<Worker | null> {
  const name = (fields.name || "").trim();
  const rate = r2(Math.max(0, +fields.rate || 0));
  if (!name) return null;
  const now = nowIso();
  const prev = fields.id ? await getRec<Worker>("workers", fields.id) : undefined;
  const opening = fields.opening === undefined ? prev?.opening || 0 : r2(Math.max(0, +fields.opening || 0));
  const w: Worker = prev
    ? { ...prev, name, rate, opening, updatedAt: now }
    : { id: "WKR-" + uid(), name, rate, opening, active: true, createdAt: now, updatedAt: now };
  await put("workers", w);
  return w;
}

/** Soft "remove" from the register — the worker and all history stay. */
export async function setWorkerActive(id: string, active: boolean): Promise<void> {
  const w = await getRec<Worker>("workers", id);
  if (!w) return;
  w.active = active;
  w.updatedAt = nowIso();
  await put("workers", w);
}

// ---- attendance marks ----

export const listAttendance = () => allRec<AttendanceMark>("attendance");

/** Upsert a day's mark (deterministic id). `present: null` clears the mark. */
export async function markAttendance(workerId: string, iso: string, present: number | null): Promise<void> {
  const id = markId(workerId, iso);
  if (present == null) {
    await delRec("attendance", id);
    return;
  }
  const now = nowIso();
  const prev = await getRec<AttendanceMark>("attendance", id);
  await put("attendance", {
    id,
    workerId,
    date: iso,
    present,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  } satisfies AttendanceMark);
}

// ---- week math (pure) ----

const isoOf = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

/** Monday of the week containing `d` (local time, midnight). */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7)); // Sun=0 → back 6, Mon=1 → back 0
  return out;
}

/** The 7 day-isos (Mon..Sun) of the week starting at `start`. */
export function weekDays(start: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return isoOf(d);
  });
}

const dmy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return d + "-" + m + "-" + y;
};

/** "29-06-2026 — 05-07-2026" */
export const fmtWeekLabel = (days: string[]) => dmy(days[0]) + " — " + dmy(days[6]);

export const prevWeek = (start: Date) => { const d = new Date(start); d.setDate(d.getDate() - 7); return d; };
export const nextWeek = (start: Date) => { const d = new Date(start); d.setDate(d.getDate() + 7); return d; };

// ---- payments (daybook is the single source of truth) ----
// Two separate pots per worker, told apart by the expense sourceId prefix:
//   "wkr:<id>"    + type "salary"              = WAGE payment (cash out)
//   "wkradv:<id>" + type "salary"              = money given onto the DEBT account (cash out)
//   "wkrded:<id>" + type "salary" + charge     = DEDUCTION: wages cut against debt (NO cash)
//   "wkr:<id>"    + type "sale"                = worker returned cash → repays the DEBT

export const workerSourceId = (workerId: string) => "wkr:" + workerId;
export const workerDebtSourceId = (workerId: string) => "wkradv:" + workerId;
export const workerDeductSourceId = (workerId: string) => "wkrded:" + workerId;

/** Hand money to a worker: one "salary" daybook expense. `kind` picks the pot —
 *  "wage" (default) settles wages, "debt" is a loan onto the debt account. `toOwner` = the
 *  OWNER paid from his own pocket (kept out of the manager's cash daybook); false = manager's cash. */
export async function payWorker(fields: {
  worker: Worker;
  amount: number;
  /** dd-mm-yy app format */
  date?: string;
  by: string;
  note?: string;
  toOwner?: boolean;
  kind?: "wage" | "debt";
}): Promise<Expense> {
  const note = fields.worker.name + (fields.note?.trim() ? " · " + fields.note.trim() : "");
  return addExpense({
    type: "salary",
    amount: fields.amount,
    mode: "",
    note,
    toOwner: fields.toOwner,
    sourceId: (fields.kind === "debt" ? workerDebtSourceId : workerSourceId)(fields.worker.id),
    date: fields.date,
    enteredBy: fields.by,
  });
}

/** Cut wages against the debt account: wage due −₹X AND debt −₹X, NO cash moves
 *  (a charge entry — inDaybook() already keeps it out of every cash book). */
export async function deductAdvance(fields: {
  worker: Worker;
  amount: number;
  /** dd-mm-yy app format */
  date?: string;
  by: string;
  note?: string;
}): Promise<Expense> {
  const note = fields.worker.name + (fields.note?.trim() ? " · " + fields.note.trim() : "");
  return addExpense({
    type: "salary",
    amount: fields.amount,
    mode: "",
    charge: true,
    note,
    sourceId: workerDeductSourceId(fields.worker.id),
    date: fields.date,
    enteredBy: fields.by,
  });
}

/** Worker returns money (repaying an advance): one "sale" cash-IN daybook entry. `toOwner` =
 *  the owner received it (stays out of the manager's daybook); false = manager's cash book. */
export async function repayWorker(fields: {
  worker: Worker;
  amount: number;
  /** dd-mm-yy app format */
  date?: string;
  by: string;
  note?: string;
  toOwner?: boolean;
}): Promise<Expense> {
  return addExpense({
    type: "sale",
    amount: fields.amount,
    mode: "cash",
    label: "Repaid · " + fields.worker.name,
    // default note so the Daybook line is self-explanatory (its rows show note || type)
    note: fields.note?.trim() || "Repaid · " + fields.worker.name,
    toOwner: fields.toOwner,
    sourceId: workerSourceId(fields.worker.id),
    date: fields.date,
    enteredBy: fields.by,
  });
}

export type WorkerEntryKind = "wage" | "debt" | "deduct" | "repaid";

export interface WorkerEntry {
  e: Expense;
  kind: WorkerEntryKind;
}

/** Every money event on a worker's account, tagged by pot (unsorted; callers sort). */
export function workerPayments(expenses: Expense[], workerId: string): WorkerEntry[] {
  const wage = workerSourceId(workerId);
  const debt = workerDebtSourceId(workerId);
  const ded = workerDeductSourceId(workerId);
  const out: WorkerEntry[] = [];
  for (const e of expenses) {
    if (e.type === "salary" && e.sourceId === wage) out.push({ e, kind: "wage" });
    else if (e.type === "salary" && e.sourceId === debt) out.push({ e, kind: "debt" });
    else if (e.type === "salary" && e.sourceId === ded) out.push({ e, kind: "deduct" });
    else if (e.type === "sale" && e.sourceId === wage) out.push({ e, kind: "repaid" });
  }
  return out;
}

// ---- all-time account (pure) ----

export interface WorkerAccount {
  /** attendance days × the worker's CURRENT rate (historic rate changes aren't replayed) */
  earnedAll: number;
  /** cash handed over as wages */
  wagePaidAll: number;
  /** cash handed over onto the debt account (loans) */
  debtGivenAll: number;
  /** wages cut against the debt (no cash) */
  deductedAll: number;
  /** cash the worker returned (repays the debt) */
  repaidAll: number;
  opening: number;
  /** wage cash taken BEYOND what was earned — automatically rolled onto the debt account
   *  (it shrinks again as more days are worked). */
  overflowAll: number;
  /** WAGE pot: earnedAll − wagePaidAll − deductedAll, floored at 0 — any overpay
   *  becomes debt (overflowAll), never a negative wage balance. */
  wageBalance: number;
  /** DEBT pot: opening + debtGivenAll − repaidAll − deductedAll + overflowAll. */
  debt: number;
}

export function workerAccount(worker: Worker, marks: AttendanceMark[], expenses: Expense[]): WorkerAccount {
  let days = 0;
  for (const m of marks) if (m.workerId === worker.id) days += +m.present || 0;
  const earnedAll = r2(days * (+worker.rate || 0));
  const sums: Record<WorkerEntryKind, number> = { wage: 0, debt: 0, deduct: 0, repaid: 0 };
  for (const { e, kind } of workerPayments(expenses, worker.id)) sums[kind] += +e.amount || 0;
  const wagePaidAll = r2(sums.wage);
  const debtGivenAll = r2(sums.debt);
  const deductedAll = r2(sums.deduct);
  const repaidAll = r2(sums.repaid);
  const opening = r2(+(worker.opening || 0));
  const rawWage = r2(earnedAll - wagePaidAll - deductedAll);
  // took more wage cash than earned → the extra automatically rolls onto the debt
  // account (and rolls back off as more days are worked — rawWage rises toward 0)
  const overflowAll = rawWage < 0 ? r2(-rawWage) : 0;
  return {
    earnedAll,
    wagePaidAll,
    debtGivenAll,
    deductedAll,
    repaidAll,
    opening,
    overflowAll,
    wageBalance: rawWage < 0 ? 0 : rawWage,
    debt: r2(opening + debtGivenAll - repaidAll - deductedAll + overflowAll),
  };
}

// ---- settings ----

export interface AttendanceCfg {
  /** payout day: 0=Sun .. 6=Sat (default Sunday) */
  payday: number;
}

const CFG_KEY = "attendanceCfg";

export const getAttendanceCfg = () => metaGet<AttendanceCfg>(CFG_KEY, { payday: 0 });
export const setAttendanceCfg = (cfg: AttendanceCfg) => metaSet(CFG_KEY, cfg);

// ---- weekly rollup (pure) ----

export interface WeekRow {
  worker: Worker;
  /** iso → present (only days that are marked) */
  marks: Record<string, number>;
  presentDays: number;
  earned: number;
  /** wages SETTLED this week: wage payments + deductions (debt loans/repayments don't touch wages) */
  paid: number;
  /** earned − paid: >0 still owed to the worker · <0 paid over this week's wages */
  balance: number;
  /** this week's wage-settling entries (wage + deduct), oldest first */
  payments: WorkerEntry[];
}

export function weekRollup(
  workers: Worker[],
  marks: AttendanceMark[],
  expenses: Expense[],
  days: string[],
): WeekRow[] {
  const from = days[0], to = days[6];
  const inWeek = (iso: string) => !!iso && iso >= from && iso <= to;
  return workers.map((worker) => {
    const wm: Record<string, number> = {};
    let presentDays = 0;
    for (const m of marks) {
      if (m.workerId !== worker.id || !inWeek(m.date)) continue;
      wm[m.date] = m.present;
      presentDays += +m.present || 0;
    }
    const payments = workerPayments(expenses, worker.id)
      .filter((x) => (x.kind === "wage" || x.kind === "deduct") && inWeek(dateSortKey(x.e.date) || (x.e.createdAt || "").slice(0, 10)))
      .sort((a, b) => (a.e.createdAt || "").localeCompare(b.e.createdAt || ""));
    const earned = r2(presentDays * (+worker.rate || 0));
    const paid = r2(payments.reduce((s, x) => s + (+x.e.amount || 0), 0));
    return { worker, marks: wm, presentDays: r2(presentDays), earned, paid, balance: r2(earned - paid), payments };
  });
}
