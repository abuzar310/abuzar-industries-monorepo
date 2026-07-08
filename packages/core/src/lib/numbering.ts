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

/** The trailing run of digits in an id, as a number (0 if none). Works for both the
 *  old "INV-2026-27-2661" ids and the new short "2661" ids. */
function trailingNum(s: string): number {
  const m = String(s).match(/(\d+)\D*$/);
  return m ? parseInt(m[1], 10) : 0;
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

/** Next number. Quotation → per-FY "2026-27-001". Invoice → a short running number like
 *  "2681" (NO "INV-FY-" prefix).
 *
 *  Invoice numbers are normally allocated ATOMICALLY from the cloud (see cloudNextInvoiceNo /
 *  createInvoice) so they can never collide across devices. This local path is only the
 *  OFFLINE fallback, and it is now MONOTONIC: it never reuses a number that has ever existed
 *  — including trashed (Recycle-bin) invoices — so a new invoice can never take a number that
 *  still names another record and overwrite it on sync. */
export async function nextNumber(kind: Kind): Promise<string> {
  const fy = fyLabel();
  const store = kind === "quotation" ? "quotations" : "invoices";
  const docs = await allRec<Doc>(store);

  if (kind === "invoice") {
    // every id ever seen locally (live OR trashed) — never reuse any of them
    const takenIds = new Set(docs.map((d) => String(d.id)));
    let mx = 0;
    for (const d of docs) mx = Math.max(mx, trailingNum(String(d.id)));
    let n = mx + 1;
    while (takenIds.has(String(n))) n++;
    return String(n);
  }

  const ids = docs.map((d) => String(d.id || ""));
  const prefix = `${fy}-`;
  const c = await metaGet<Seq>("seqQ", { fy, n: 0 });
  const n = nextSeq(ids, c.fy === fy ? c.n : 0, prefix);
  await metaSet("seqQ", { fy, n });
  return prefix + pad(n, 3);
}

export async function resetCounters() {
  const fy = fyLabel();
  await metaSet("seqQ", { fy, n: 0 });
  await metaSet("seqI", { fy, n: 0 });
}

/** Bump the quotation counter so the next quotation follows the highest already stored
 *  (prevents reusing a number after a cloud restore). Invoices need no counter — their
 *  number is derived live from the active invoices in nextNumber(). */
export async function fixCounters() {
  const fy = fyLabel();
  const re = new RegExp("^" + fy + "-(\\d+)$");
  const arr = await allRec<Doc>("quotations");
  let mx = 0;
  arr.forEach((d) => {
    const m = String(d.id || "").match(re);
    if (m) mx = Math.max(mx, parseInt(m[1], 10));
  });
  const cur = await metaGet<Seq>("seqQ", { fy, n: 0 });
  if (cur.fy !== fy || (cur.n || 0) < mx) await metaSet("seqQ", { fy, n: mx });
}
