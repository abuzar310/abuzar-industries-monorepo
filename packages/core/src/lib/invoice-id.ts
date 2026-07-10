// Invoice identity vs display number.
//
//   id      = permanent UID (e.g. "inv_a1b2c3…"). Sync / URLs / ledger keys. NEVER reused.
//   number  = what humans see ("1", "2", "2695"). Editable. Per trade-type series.
//
// Delete + create ⇒ new UID every time, but the DISPLAY number is reused from the first
// hole in the live series (same clean serial behaviour for sales AND purchases).
// Example: live 2718 + 2721 → next create is 2719 (not 2722). Delete 2721 → next is 2721.

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
  const s = String(d.number || "").trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return 0;
}

function takenFromDocs(docs: Doc[], trade: InvoiceTrade): Set<number> {
  const taken = new Set<number>();
  for (const d of docs) {
    if (!isLiveDoc(d)) continue;
    if (trade === "buy" ? !isBuy(d) : isBuy(d)) continue;
    const n = numericLabel(d);
    if (n > 0) taken.add(n);
  }
  return taken;
}

/** Live display numbers for this trade from the cloud (so every device fills the same holes). */
async function cloudLiveTaken(trade: InvoiceTrade): Promise<Set<number>> {
  const taken = new Set<number>();
  const supa = getSupa();
  if (!supa.url || !supa.key) return taken;
  if (typeof navigator !== "undefined" && !navigator.onLine) return taken;
  if (authRequired() && !isLoggedIn()) return taken;
  try {
    await ensureAuth();
    const k = (supa.key || "").trim();
    const auth = getAuth();
    const r = await fetch(supa.url + "/rest/v1/" + tableName("invoices") + "?select=id,data", {
      headers: { apikey: k, Authorization: "Bearer " + (auth.token || k) },
    });
    if (!r.ok) return taken;
    const rows = await r.json();
    if (!Array.isArray(rows)) return taken;
    for (const row of rows) {
      const d = (row && row.data) || {};
      if (d.deletedAt || d.purgedAt) continue;
      const buy = d.tradeType === "buy";
      if (trade === "buy" ? !buy : buy) continue;
      const s = String(d.number || "").trim();
      if (/^\d+$/.test(s)) taken.add(parseInt(s, 10));
    }
  } catch {
    /* offline / error — local taken is enough */
  }
  return taken;
}

/**
 * Lowest free serial in the live series.
 *  - purchases: search from 1 (1,2,3… with hole reuse)
 *  - sales: reuse a small tip hole (live 2718+2721 → 2719), else max+1.
 *    Won't rewind into ancient gaps (e.g. 2700) from old deletes.
 */
export function nextFreeLiveDisplay(taken: Set<number>, trade: InvoiceTrade): number {
  if (trade === "buy") {
    let n = 1;
    while (taken.has(n)) n++;
    return n;
  }

  const series = [...taken].filter((n) => n >= 100).sort((a, b) => a - b);
  if (series.length === 0) {
    let n = 1;
    while (taken.has(n)) n++;
    return n;
  }
  const maxN = series[series.length - 1];
  const prev = series.length >= 2 ? series[series.length - 2] : null;
  // Recent delete left a small hole under the tip — fill it (clean serial).
  if (prev != null && maxN - prev > 1 && maxN - prev <= 20) {
    for (let n = prev + 1; n < maxN; n++) {
      if (!taken.has(n)) return n;
    }
  }
  return maxN + 1;
}

/**
 * Next display number for a new invoice (sales AND purchases): clean serial with hole reuse.
 * UID stays unique on every create; only the printed number is recycled after a delete.
 */
export async function nextInvoiceDisplayNumber(trade: InvoiceTrade): Promise<string> {
  const docs = await allRec<Doc>("invoices");
  const taken = takenFromDocs(docs, trade);
  for (const n of await cloudLiveTaken(trade)) taken.add(n);

  const n = nextFreeLiveDisplay(taken, trade);

  // Best-effort: keep the cloud counter near the series tip so older clients stay sane.
  // Never let the counter dictate a jump past a live hole.
  try {
    const tip = Math.max(n, ...taken, 0);
    let guard = 0;
    let c = await cloudNextInvoiceNo();
    while (c != null && c < tip && guard++ < 20) {
      c = await cloudNextInvoiceNo();
    }
  } catch {
    /* ignore */
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
