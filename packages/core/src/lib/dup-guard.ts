// Duplicate-entry guard for money coming IN (Receipts tab, the quotation payment box,
// Place rent received). Read-only: it looks at the rows already in the cache and reports a
// recent look-alike so the screen can ask "record again?" BEFORE anything is written.
// It never writes and never changes what gets recorded — the caller decides.
//
// Why: the books carry the same receipt recorded twice 7–12 seconds apart (a second press
// of Record) and the same rent received entered by two people two minutes apart.
import type { Expense } from "./types";

export interface DupQuery {
  amount: number;
  /** what the new entry would be saved as — Cash → Owner counts as cash. */
  mode: "cash" | "upi";
  /** customer account receipt / Receipts-tab waterfall target. */
  custId?: string;
  /** that customer's quotation ids — a Receipts-tab receipt is split across them. */
  quoteIds?: string[];
  /** a payment on one quotation (editor payment box). */
  sourceId?: string;
  /** place-rent tenant (carpenter directory id). */
  carpenterId?: string;
  /** "Received from name" party. */
  party?: string;
  /** look-back window; default 15 minutes. */
  withinMs?: number;
  /** clock, for the check file. */
  now?: number;
}

export interface DupHit {
  /** the earlier row (first piece when that receipt was split across quotations). */
  expense: Expense;
  /** the amount handed over then (all pieces sharing one rcptId added up). */
  amount: number;
  agoMs: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const key = (s: string | undefined) => (s || "").trim().toLowerCase();
const modeOf = (e: Expense): "cash" | "upi" => (e.mode === "upi" ? "upi" : "cash");

/** Is this earlier row aimed at the same person / paper as the entry about to be made? */
function sameTarget(e: Expense, q: DupQuery): boolean {
  if (q.sourceId && e.sourceId === q.sourceId) return true;
  if (q.custId && e.custId === q.custId) return true;
  if (q.quoteIds?.length && e.sourceId && q.quoteIds.includes(e.sourceId)) return true;
  if (q.carpenterId && e.carpenterId === q.carpenterId && e.placeRentKind === "received") return true;
  if (q.party && !e.custId && !e.sourceId && !e.carpenterId && key(e.party) === key(q.party)) return true;
  return false;
}

/** The most recent money-in row that looks like the entry about to be made, or undefined. */
export function findRecentDuplicate(expenses: Expense[], q: DupQuery): DupHit | undefined {
  const want = r2(+q.amount || 0);
  if (want <= 0) return undefined;
  const now = q.now ?? Date.now();
  const win = q.withinMs ?? DEFAULT_WINDOW_MS;

  // money-in rows, same mode, same target, recorded inside the window.
  // An advance moved onto a quotation (fromAdvanceId) is a transfer, not cash handed over — skip it.
  // The window runs both ways: a row from the other phone can sit "in the future" when its clock is fast.
  const recent = expenses.filter((e) => {
    if (e.type !== "sale" || e.charge || e.fromAdvanceId) return false;
    if (modeOf(e) !== q.mode) return false;
    if (!sameTarget(e, q)) return false;
    const t = Date.parse(e.createdAt || "");
    if (!Number.isFinite(t)) return false;
    return Math.abs(now - t) <= win;
  });
  if (!recent.length) return undefined;

  // one handover split across quotations shares an rcptId — compare the whole handover
  const groups = new Map<string, Expense[]>();
  for (const e of recent) {
    const g = e.rcptId || e.id;
    groups.set(g, [...(groups.get(g) || []), e]);
  }
  let best: DupHit | undefined;
  for (const rows of groups.values()) {
    const rid = rows[0].rcptId;
    const all = rid ? expenses.filter((e) => e.rcptId === rid && e.type === "sale" && !e.charge && !e.fromAdvanceId) : rows;
    const total = r2(all.reduce((s, e) => s + (+e.amount || 0), 0));
    if (Math.abs(total - want) > 0.5) continue;
    const first = all.slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))[0];
    const ago = now - Date.parse(first.createdAt || "");
    if (!best || ago < best.agoMs) best = { expense: first, amount: total, agoMs: ago };
  }
  return best;
}

/** "7 seconds ago" / "3 minutes ago" for the confirm box. */
export function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + (s === 1 ? " second ago" : " seconds ago");
  const m = Math.round(s / 60);
  return m + (m === 1 ? " minute ago" : " minutes ago");
}
