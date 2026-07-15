// Worker wage register (weekly, MON → SUN). Attendance marks live in their own
// store; the MONEY (advances + wages) lives ONLY in the daybook as "salary"
// expenses tagged sourceId "wkr:<workerId>" — never duplicated here.
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
  /** ₹ the worker owed at the start (lump-sum credit/loan the company gave them). */
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

export const workerSourceId = (workerId: string) => "wkr:" + workerId;

/** Record a wage / advance: one "salary" daybook expense. `toOwner` = the OWNER paid from
 *  his own pocket (kept out of the manager's cash daybook); false = manager's cash. */
export async function payWorker(fields: {
  worker: Worker;
  amount: number;
  /** dd-mm-yy app format */
  date?: string;
  by: string;
  note?: string;
  toOwner?: boolean;
}): Promise<Expense> {
  const note = fields.worker.name + (fields.note?.trim() ? " · " + fields.note.trim() : "");
  return addExpense({
    type: "salary",
    amount: fields.amount,
    mode: "",
    note,
    toOwner: fields.toOwner,
    sourceId: workerSourceId(fields.worker.id),
    date: fields.date,
    enteredBy: fields.by,
  });
}

/** Every payment made to a worker (newest last; callers sort as needed).
 *  There is ONE account per worker: wages earned credit it, money given debits it —
 *  any extra taken simply stays on the account as their debt. No separate flows. */
export const workerPayments = (expenses: Expense[], workerId: string): Expense[] =>
  expenses.filter((e) => e.type === "salary" && e.sourceId === workerSourceId(workerId));

// ---- all-time account (pure) ----

export interface WorkerAccount {
  /** attendance days × the worker's CURRENT rate (historic rate changes aren't replayed) */
  earnedAll: number;
  givenAll: number;
  opening: number;
  /** earnedAll − opening − givenAll. NEGATIVE = worker owes the company (advance/debt) ·
   *  POSITIVE = company owes the worker unpaid wages · 0 = square. */
  balance: number;
}

export function workerAccount(worker: Worker, marks: AttendanceMark[], expenses: Expense[]): WorkerAccount {
  let days = 0;
  for (const m of marks) if (m.workerId === worker.id) days += +m.present || 0;
  const earnedAll = r2(days * (+worker.rate || 0));
  const givenAll = r2(workerPayments(expenses, worker.id).reduce((s, e) => s + (+e.amount || 0), 0));
  const opening = r2(+(worker.opening || 0));
  return { earnedAll, givenAll, opening, balance: r2(earnedAll - opening - givenAll) };
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
  /** money GIVEN to the worker this week (repayments don't count as wages paid) */
  paid: number;
  /** earned − paid: >0 still owed to the worker · <0 the worker owes (advance) */
  balance: number;
  /** this week's "given" payments, oldest first */
  payments: Expense[];
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
      .filter((e) => inWeek(dateSortKey(e.date) || (e.createdAt || "").slice(0, 10)))
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const earned = r2(presentDays * (+worker.rate || 0));
    const paid = r2(payments.reduce((s, e) => s + (+e.amount || 0), 0));
    return { worker, marks: wm, presentDays: r2(presentDays), earned, paid, balance: r2(earned - paid), payments };
  });
}
