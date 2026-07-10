// Data-durability policy for quotations + invoices.
//
// Historical "invoice went missing" bugs came from three places:
//   1. Renaming a document number also changed its primary key and DELETEd the old
//      cloud row — a mid-flight failure or id collision silently destroyed data.
//   2. Permanent purge hard-DELETEd the cloud row, and realtime then wiped every device.
//   3. Sync UPSERT keyed on id could overwrite a different document that shared an id.
//
// Rules enforced across the app (see trash.ts, Editor commitNumber, cloud.ts, AppProvider,
// invoice-id.ts):
//   - Invoice `id` is a permanent UID (`inv_…`). Changing the printed `number` never
//     renames the id and never deletes a cloud row.
//   - Display numbers are per trade-type labels (purchases 1,2,3… with gap reuse; sales
//     keep the high running series). Deleting purchase #3 frees label "3" for the next buy.
//   - Quotations/invoices are NEVER hard-deleted from the cloud. "Delete forever" only
//     sets purgedAt; the row stays recoverable.
//   - Remote DELETE events for docs are ignored / converted to a local purge marker so
//     one device cannot wipe another.
//   - Id allocation never reuses a live OR purged id (purged rows stay in the store).

import { allRec } from "./db";
import type { Doc, DocStore } from "./types";

/** A doc that should appear in normal lists (not bin, not purged). */
export const isLiveDoc = (d: Doc) => !d.deletedAt && !d.purgedAt;

/** A doc sitting in the Recycle bin (soft-deleted, still recoverable). */
export const isTrashedDoc = (d: Doc) => !!d.deletedAt && !d.purgedAt;

/** Find a live doc that already uses this display number (id is ignored — numbers are labels).
 *  For invoices, pass tradeType so purchase "1" and sales "1" don't collide. */
export async function findLiveByNumber(
  store: DocStore,
  number: string,
  exceptId?: string,
  tradeType?: "buy" | "sell",
): Promise<Doc | undefined> {
  const v = (number || "").trim();
  if (!v) return undefined;
  const all = await allRec<Doc>(store);
  return all.find((d) => {
    if (!isLiveDoc(d) || d.id === exceptId) return false;
    if (String(d.number || "").trim() !== v && d.id !== v) return false;
    if (store === "invoices" && tradeType) {
      const buy = d.tradeType === "buy";
      if (tradeType === "buy" ? !buy : buy) return false;
    }
    return true;
  });
}
