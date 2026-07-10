// Invoice identity vs display number.
//
//   id      = permanent UID (e.g. "inv_a1b2c3…"). Sync / URLs / ledger keys. NEVER reused.
//   number  = what humans see ("1", "2", "2695"). Editable. Per trade-type series.
//
// Delete + create ⇒ new UID every time. Display numbers for SALES are strictly monotonic:
//   if the highest sales invoice on the list is 2714, the next create is 2715 — never a
//   hole like 2615 from a stale counter. Purchases keep a separate 1,2,3… series with
//   gap reuse among live buys only.

import { allRec } from "./db";
import {
  cloudNextInvoiceNo,
  ensureAuth,
  getAuth,
  getSupa,
  authRequired,
  isLoggedIn,
  tableName,
} from "./cloud";
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

function isBuy(d: Doc): boolean {
  return d.tradeType === "buy";
}

function numericLabel(d: Doc): number {
  for (const label of [d.number, d.id]) {
    const s = String(label || "").trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
  }
  return 0;
}

/** Highest numeric display label in this trade series (optionally including bin/archive). */
function maxNumericInTrade(docs: Doc[], trade: InvoiceTrade, includeDead: boolean): number {
  let mx = 0;
  for (const d of docs) {
    if (!includeDead && !isLiveDoc(d)) continue;
    if (trade === "buy" ? !isBuy(d) : isBuy(d)) continue;
    mx = Math.max(mx, numericLabel(d));
  }
  return mx;
}

function takenLiveNums(docs: Doc[], trade: InvoiceTrade): Set<number> {
  const taken = new Set<number>();
  for (const d of docs) {
    if (!isLiveDoc(d)) continue;
    if (trade === "buy" ? !isBuy(d) : isBuy(d)) continue;
    const n = numericLabel(d);
    if (n > 0) taken.add(n);
  }
  return taken;
}

/** Max sales display number currently in the cloud (authoritative across devices). */
async function cloudMaxSellDisplay(): Promise<number> {
  const supa = getSupa();
  if (!supa.url || !supa.key) return 0;
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  if (authRequired() && !isLoggedIn()) return 0;
  try {
    await ensureAuth();
    const k = (supa.key || "").trim();
    const auth = getAuth();
    const r = await fetch(supa.url + "/rest/v1/" + tableName("invoices") + "?select=id,data", {
      headers: {
        apikey: k,
        Authorization: "Bearer " + (auth.token || k),
      },
    });
    if (!r.ok) return 0;
    const rows = await r.json();
    if (!Array.isArray(rows)) return 0;
    let mx = 0;
    for (const row of rows) {
      const d = (row && row.data) || {};
      if (d.tradeType === "buy") continue;
      for (const label of [d.number, row.id]) {
        const s = String(label || "").trim();
        if (/^\d+$/.test(s)) mx = Math.max(mx, parseInt(s, 10));
      }
    }
    return mx;
  } catch {
    return 0;
  }
}

/**
 * Next display number for a new invoice.
 *  - buy  → lowest free positive int among live purchases (delete 3 → next can be 3)
 *  - sell → strictly after the highest sales number anywhere (local + cloud + counter).
 *           Top of list 2714 ⇒ next is 2715. Never jumps backward into a hole (2615).
 */
export async function nextInvoiceDisplayNumber(trade: InvoiceTrade): Promise<string> {
  const docs = await allRec<Doc>("invoices");
  const taken = takenLiveNums(docs, trade);

  if (trade === "buy") {
    let n = 1;
    while (taken.has(n)) n++;
    return String(n);
  }

  // Floor = one past the highest sales number we've ever seen (bin/archive count too,
  // so delete-then-create never rewinds the series).
  const localMax = maxNumericInTrade(docs, "sell", true);
  const remoteMax = await cloudMaxSellDisplay();
  const floor = Math.max(localMax, remoteMax) + 1;

  // Atomic cloud counter — catch it up if it's behind the real max (stale counter bug).
  let n = (await cloudNextInvoiceNo()) ?? floor;
  let guard = 0;
  while (n < floor && guard++ < 500) {
    const next = await cloudNextInvoiceNo();
    if (next == null) {
      n = floor;
      break;
    }
    n = next;
  }
  n = Math.max(n, floor);

  while (taken.has(n)) {
    const next = await cloudNextInvoiceNo();
    n = next != null ? Math.max(next, n + 1) : n + 1;
  }
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
  return docs.find((d) => {
    if (!isLiveDoc(d) || d.id === exceptId) return false;
    if (trade === "buy" ? !isBuy(d) : isBuy(d)) return false;
    return String(d.number || "").trim() === v;
  });
}

/** Offline-safe local monotonic fallback (legacy path / tests). Prefer nextInvoiceDisplayNumber. */
export async function localNextSalesDisplayNumber(): Promise<string> {
  return nextNumber("invoice");
}
