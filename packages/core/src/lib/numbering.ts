import { allRec, metaGet, metaSet } from "./db";
import { pad } from "./calc";
import type { Doc, Kind } from "./types";

interface Seq {
  fy: string;
  n: number;
}

/** Indian financial-year label for a date, e.g. "2026-27" (FY starts in April). */
export function fyLabel(d = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= 4 ? y : y - 1;
  return start + "-" + pad((start + 1) % 100, 2);
}

/** Next per-FY number. Quotation → "2026-27-001"; Invoice → "INV-2026-27-001". */
export async function nextNumber(kind: Kind): Promise<string> {
  const fy = fyLabel();
  const key = kind === "quotation" ? "seqQ" : "seqI";
  const c = await metaGet<Seq>(key, { fy, n: 0 });
  const n = (c.fy === fy ? c.n : 0) + 1;
  await metaSet(key, { fy, n });
  const seq = pad(n, 3);
  return kind === "quotation" ? `${fy}-${seq}` : `INV-${fy}-${seq}`;
}

export async function resetCounters() {
  const fy = fyLabel();
  await metaSet("seqQ", { fy, n: 0 });
  await metaSet("seqI", { fy, n: 0 });
}

/** Bump counters so the next number follows the highest already stored
 *  (prevents reusing a number after a cloud restore). */
export async function fixCounters() {
  const fy = fyLabel();
  for (const [s, key, re] of [
    ["quotations", "seqQ", new RegExp("^" + fy + "-(\\d+)$")],
    ["invoices", "seqI", new RegExp("^INV-" + fy + "-(\\d+)$")],
  ] as const) {
    const arr = await allRec<Doc>(s);
    let mx = 0;
    arr.forEach((d) => {
      const m = String(d.id || "").match(re);
      if (m) mx = Math.max(mx, parseInt(m[1], 10));
    });
    const cur = await metaGet<Seq>(key, { fy, n: 0 });
    if (cur.fy !== fy || (cur.n || 0) < mx) await metaSet(key, { fy, n: mx });
  }
}
