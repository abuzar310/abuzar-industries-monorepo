import { allRec, metaGet, metaSet } from "./db";
import { pad } from "./calc";
import type { Doc, Kind } from "./types";

interface Seq {
  year: number;
  n: number;
}

/** Next per-year document number, e.g. "QTN-2026-001" / "INV-2026-001". */
export async function nextNumber(kind: Kind): Promise<string> {
  const year = new Date().getFullYear();
  const key = kind === "quotation" ? "seqQ" : "seqI";
  const c = await metaGet<Seq>(key, { year, n: 0 });
  const n = (c.year === year ? c.n : 0) + 1;
  await metaSet(key, { year, n });
  const prefix = kind === "quotation" ? "QTN" : "INV";
  return `${prefix}-${year}-${pad(n, 3)}`;
}

export async function resetCounters() {
  const year = new Date().getFullYear();
  await metaSet("seqQ", { year, n: 0 });
  await metaSet("seqI", { year, n: 0 });
}

/** Bump counters so the next number follows the highest one already stored
 *  (prevents reusing a number after a cloud restore). */
export async function fixCounters() {
  const year = new Date().getFullYear();
  for (const [s, key, prefix] of [
    ["quotations", "seqQ", "QTN"],
    ["invoices", "seqI", "INV"],
  ] as const) {
    const arr = await allRec<Doc>(s);
    let mx = 0;
    const re = new RegExp("^" + prefix + "-" + year + "-(\\d+)$");
    arr.forEach((d) => {
      const m = String(d.id || "").match(re);
      if (m) mx = Math.max(mx, parseInt(m[1], 10));
    });
    const cur = await metaGet<Seq>(key, { year, n: 0 });
    if (cur.year !== year || (cur.n || 0) < mx) await metaSet(key, { year, n: mx });
  }
}
