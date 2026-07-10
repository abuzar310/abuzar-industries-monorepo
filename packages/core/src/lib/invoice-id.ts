// Invoice identity vs display number.
//
//   id      = permanent UID (e.g. "inv_a1b2c3…"). Sync / URLs / ledger keys. NEVER reused.
//   number  = what humans see ("1", "2", "2695"). Editable. Per trade-type series.
//
// Why: when id === number, deleting "3" left a tombstone/row at id "3", so the next create
// became "4". With a UID id, deleting purchase #3 only frees the DISPLAY number "3" — the
// next purchase can be "3" again without touching any cloud primary key.
//
// Sales keep the high running series (cloud counter). Purchases use 1, 2, 3… with gap reuse
// among LIVE buys only (trashed/purged numbers are free to reuse as labels).

import { allRec } from "./db";
import { cloudNextInvoiceNo } from "./cloud";
import { isLiveDoc } from "./durability";
import { nextNumber } from "./numbering";
import type { Doc } from "./types";

export type InvoiceTrade = "buy" | "sell";

/** Opaque permanent invoice primary key. */
export function newInvoiceUid(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  return "inv_" + rand.slice(0, 20);
}

export function isInvoiceUid(id: string): boolean {
  return /^inv_[a-z0-9]+$/i.test(id || "");
}

/** Live invoices in this trade series (unset tradeType counts as sell). */
function liveInTrade(docs: Doc[], trade: InvoiceTrade): Doc[] {
  return docs.filter((d) => {
    if (!isLiveDoc(d)) return false;
    const buy = d.tradeType === "buy";
    return trade === "buy" ? buy : !buy;
  });
}

/** Numeric display labels already used by LIVE docs in this trade series. */
function takenDisplayNums(docs: Doc[], trade: InvoiceTrade): Set<number> {
  const taken = new Set<number>();
  for (const d of liveInTrade(docs, trade)) {
    const label = String(d.number || "").trim();
    if (/^\d+$/.test(label)) taken.add(parseInt(label, 10));
  }
  return taken;
}

/**
 * Next display number for a new invoice.
 *  - buy  → lowest free positive int among live purchases (delete 3 → next can be 3)
 *  - sell → cloud atomic counter (continues 2714…), skipping any live collision
 */
export async function nextInvoiceDisplayNumber(trade: InvoiceTrade): Promise<string> {
  const docs = await allRec<Doc>("invoices");
  const taken = takenDisplayNums(docs, trade);

  if (trade === "buy") {
    let n = 1;
    while (taken.has(n)) n++;
    return String(n);
  }

  // Sales: prefer cloud counter so devices don't collide on the high series.
  let n = (await cloudNextInvoiceNo()) ?? 0;
  if (!n) {
    // offline fallback — above every numeric sales label we've ever seen locally
    let mx = 0;
    for (const d of docs) {
      if (d.tradeType === "buy") continue;
      const label = String(d.number || d.id || "");
      if (/^\d+$/.test(label)) mx = Math.max(mx, parseInt(label, 10));
    }
    n = mx + 1;
  }
  while (taken.has(n)) n++;
  return String(n);
}

/** True if another LIVE invoice in the same trade series already shows this number. */
export async function findLiveInvoiceByDisplayNumber(
  number: string,
  trade: InvoiceTrade,
  exceptId?: string,
): Promise<Doc | undefined> {
  const v = (number || "").trim();
  if (!v) return undefined;
  const docs = await allRec<Doc>("invoices");
  return liveInTrade(docs, trade).find(
    (d) => d.id !== exceptId && String(d.number || "").trim() === v,
  );
}

/** Offline-safe local monotonic fallback (legacy path / tests). Prefer nextInvoiceDisplayNumber. */
export async function localNextSalesDisplayNumber(): Promise<string> {
  return nextNumber("invoice");
}
