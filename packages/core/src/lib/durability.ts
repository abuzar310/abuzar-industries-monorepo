// Data-durability policy for quotations + invoices.
//
// Rules enforced across the app (see trash.ts, Editor commitNumber, server/api.ts):
//   - Invoice `id` is a permanent UID (`inv_…`). Changing the printed `number` never
//     renames the id and never deletes a database row.
//   - Display numbers are per trade-type labels (purchases 1,2,3… with gap reuse; sales
//     keep the high running series). Deleting purchase #3 frees label "3" for the next buy.
//   - Quotations/invoices are NEVER hard-deleted. "Delete forever" only sets purgedAt;
//     the row stays recoverable, and id allocation never reuses a live OR purged id.

import { allRec } from "./data";
import { seriesOf, type InvoiceSeries } from "./invoice-id";
import type { Doc, DocStore } from "./types";

/** A doc that should appear in normal lists (not bin, not purged). */
export const isLiveDoc = (d: Doc) => !d.deletedAt && !d.purgedAt;

/** A doc sitting in the Recycle bin (soft-deleted, still recoverable). */
export const isTrashedDoc = (d: Doc) => !!d.deletedAt && !d.purgedAt;

/** Find a live doc that already uses this display number (id is ignored — numbers are labels).
 *  For invoices, pass the series so purchase "1", rented "R-1" and sales "1" never collide. */
export async function findLiveByNumber(
  store: DocStore,
  number: string,
  exceptId?: string,
  series?: InvoiceSeries,
): Promise<Doc | undefined> {
  const v = (number || "").trim();
  if (!v) return undefined;
  const all = await allRec<Doc>(store);
  return all.find((d) => {
    if (!isLiveDoc(d) || d.id === exceptId) return false;
    if (String(d.number || "").trim() !== v && d.id !== v) return false;
    if (store === "invoices" && series && seriesOf(d) !== series) return false;
    return true;
  });
}
