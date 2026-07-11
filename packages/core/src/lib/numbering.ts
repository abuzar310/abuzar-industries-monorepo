// Financial-year helpers. ALL document numbers are now allocated atomically by
// the database (see server/api.ts createDocAtomic) — there are no local
// counters, so two devices can never mint the same number.
import { pad } from "./calc";

/** Indian financial-year label for a date, e.g. "2026-27" (FY starts in April). */
export function fyLabel(d = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= 4 ? y : y - 1;
  return start + "-" + pad((start + 1) % 100, 2);
}

/** Pure helper kept for reference/tests: next free sequence above a counter and
 *  every existing id with the given prefix. */
export function nextSeq(existingIds: string[], counterN: number, prefix: string): number {
  const taken = new Set(existingIds);
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d+)$");
  let mx = counterN || 0;
  for (const id of existingIds) {
    const m = id.match(re);
    if (m) mx = Math.max(mx, parseInt(m[1], 10));
  }
  let n = mx + 1;
  while (taken.has(prefix + String(n).padStart(3, "0"))) n++;
  return n;
}
