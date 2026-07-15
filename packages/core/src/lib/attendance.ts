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

export async function saveWorker(fields: { id?: string; name: string; rate: number }): Promise<Worker | null> {
  const name = (fields.name || "").trim();
  const rate = r2(Math.max(0, +fields.rate || 0));
  if (!name) return null;
  const now = nowIso();
  const prev = fields.id ? await getRec<Worker>("workers", fields.id) : undefined;
  const w: Worker = prev
    ? { ...prev, name, rate, updatedAt: now }
    : { id: "WKR-" + uid(), name, rate, active: true, createdAt: now, updatedAt: now };
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

/** Record a wage / advance: one "salary" daybook expense (cash out of the manager's book). */
export async function payWorker(fields: {
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
    note,
    sourceId: workerSourceId(fields.worker.id),
    date: fields.date,
    enteredBy: fields.by,
  });
}

export const workerPayments = (expenses: Expense[], workerId: string) =>
  expenses.filter((e) => e.sourceId === workerSourceId(workerId));

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
  paid: number;
  /** earned − paid: >0 still owed to the worker · <0 the worker owes (advance) */
  balance: number;
  /** this week's payments, oldest first */
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
