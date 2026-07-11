// Invoice identity vs display number.
//
//   id      = permanent UID (e.g. "inv_a1b2c3…"). URLs / ledger keys. NEVER reused.
//   number  = what humans see ("1", "2695", "R-3"). Editable. Per SERIES.
//
// Three independent series, so numbers never mix:
//   sell → the running sales serial ("2695", "2696", …)
//   buy  → purchases from 1 with hole reuse ("1", "2", …)
//   rent → rented invoices with their own "R-1", "R-2", … serial
//
// Allocation happens ATOMICALLY on the server (rpc/create-doc + rpc/next-invoice-number
// run nextFreeLiveDisplay inside an advisory lock), so every device fills the same
// holes. The pure helpers here are shared by server/api.ts — keep them free of
// client-only imports.

import { listCached } from "./data";
import { isLiveDoc } from "./durability";
import type { Doc } from "./types";

export type InvoiceTrade = "buy" | "sell";
/** The number series an invoice belongs to (rented sales run their own serial). */
export type InvoiceSeries = "sell" | "buy" | "rent";

/** Which series an invoice's display number lives in. */
export const seriesOf = (d: Pick<Doc, "tradeType" | "rented">): InvoiceSeries =>
  d.tradeType === "buy" ? "buy" : d.rented ? "rent" : "sell";

/** Parse a display number into its serial within a series (0 = not part of the series). */
export function seriesNumeric(series: InvoiceSeries, number: unknown): number {
  const s = String(number ?? "").trim();
  if (series === "rent") {
    const m = s.match(/^R-?(\d+)$/i);
    return m ? parseInt(m[1], 10) : 0;
  }
  return /^\d+$/.test(s) ? parseInt(s, 10) : 0;
}

/** Render a serial as the display number for its series. */
export const formatSeriesNumber = (series: InvoiceSeries, n: number): string =>
  series === "rent" ? "R-" + n : String(n);

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

/**
 * Lowest free serial in the live series.
 *  - purchases + rented: search from 1 (1,2,3… with hole reuse)
 *  - sales: reuse a small tip hole (live 2718+2721 → 2719), else max+1.
 *    Won't rewind into ancient gaps (e.g. 2700) from old deletes.
 */
export function nextFreeLiveDisplay(taken: Set<number>, series: InvoiceTrade | InvoiceSeries): number {
  if (series === "buy" || series === "rent") {
    let n = 1;
    while (taken.has(n)) n++;
    return n;
  }

  const sorted = [...taken].filter((n) => n >= 100).sort((a, b) => a - b);
  if (sorted.length === 0) {
    let n = 1;
    while (taken.has(n)) n++;
    return n;
  }
  const maxN = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  // Recent delete left a small hole under the tip — fill it (clean serial).
  if (prev != null && maxN - prev > 1 && maxN - prev <= 20) {
    for (let n = prev + 1; n < maxN; n++) {
      if (!taken.has(n)) return n;
    }
  }
  return maxN + 1;
}

/** True if another LIVE invoice in the same series already shows this number.
 *  Used by the editor's manual number edit (over the client cache). */
export async function findLiveInvoiceByDisplayNumber(
  number: string,
  series: InvoiceTrade | InvoiceSeries,
  exceptId?: string,
): Promise<Doc | undefined> {
  const v = (number || "").trim();
  if (!v) return undefined;
  const want: InvoiceSeries = series === "buy" ? "buy" : series === "rent" ? "rent" : "sell";
  return listCached<Doc>("invoices").find((d) => {
    if (!isLiveDoc(d) || d.id === exceptId) return false;
    if (seriesOf(d) !== want) return false;
    return String(d.number || "").trim() === v;
  });
}
