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

/** Continue an invoice number from the last created one — increments its trailing
 *  digits and keeps whatever prefix/suffix the user used (custom or template). */
async function continueInvoiceNumber(): Promise<string | null> {
  const arr = await allRec<Doc>("invoices");
  if (!arr.length) return null;
  const last = arr.reduce((a, b) => ((a.createdAt || "") >= (b.createdAt || "") ? a : b));
  const s = String(last.number || last.id || "");
  const m = s.match(/(\d+)(\D*)$/); // the last run of digits + any trailing text
  if (!m) return null;
  const num = m[1];
  const next = String(parseInt(num, 10) + 1).padStart(num.length, "0");
  return s.slice(0, m.index) + next + m[2];
}

/** Next FREE sequence number for a prefix: strictly above the stored counter AND every id already
 *  present, and never an id that's already taken. This stops a stale counter (after a mirror/restore)
 *  from handing out an in-use number and letting the sync UPSERT overwrite an existing document. */
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

/** Next per-FY number. Quotation → "2026-27-001"; Invoice → continues from the last invoice
 *  (or "INV-2026-27-001" for the very first). Collision-proof against every id on this device. */
export async function nextNumber(kind: Kind): Promise<string> {
  const fy = fyLabel();
  const store = kind === "quotation" ? "quotations" : "invoices";
  const ids = (await allRec<Doc>(store)).map((d) => String(d.id || ""));

  if (kind === "invoice") {
    const cont = await continueInvoiceNumber();
    if (cont && !ids.includes(cont)) return cont; // reuse a continued number only if it's free
  }
  const key = kind === "quotation" ? "seqQ" : "seqI";
  const prefix = kind === "quotation" ? `${fy}-` : `INV-${fy}-`;
  const c = await metaGet<Seq>(key, { fy, n: 0 });
  const n = nextSeq(ids, c.fy === fy ? c.n : 0, prefix);
  await metaSet(key, { fy, n });
  return prefix + pad(n, 3);
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
