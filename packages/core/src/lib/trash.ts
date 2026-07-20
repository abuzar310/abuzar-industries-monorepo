// Recycle bin — soft-delete for documents. A delete just flags the doc and keeps it in the
// cloud, so nothing is ever really lost; the owner restores or purges it from Settings.
//
// DURABILITY: purge never hard-DELETEs. It only sets purgedAt — the row stays in the
// database forever and is always recoverable. See durability.ts.
import { allRec, getRec, put } from "./data";
import { nowIso } from "./calc";
import { isTrashedDoc } from "./durability";
import { deleteExpensesBySource } from "./expenses";
import type { Doc, DocStore } from "./types";

/** Move a document to the Recycle bin (soft-delete). Not hard-deleted, so it's always recoverable. */
export async function trashDoc(store: DocStore, id: string): Promise<void> {
  const d = await getRec<Doc>(store, id);
  if (!d) return;
  d.deletedAt = nowIso();
  d.updatedAt = nowIso();
  await put(store, d);
}

/** Restore a doc from the Recycle bin back into its list. */
export async function restoreDoc(store: DocStore, id: string): Promise<void> {
  const d = await getRec<Doc>(store, id);
  if (!d) return;
  delete d.deletedAt;
  delete d.purgedAt; // also un-purge if recovering from archive
  d.updatedAt = nowIso();
  await put(store, d);
}

/** Mark a trashed doc as purged — hidden from the bin, but the row STAYS in the cloud forever.
 *  Recover via restoreDoc. */
export async function purgeDoc(store: DocStore, id: string): Promise<void> {
  const d = await getRec<Doc>(store, id);
  if (!d) return;
  // Drop linked daybook lines (those are regenerable); keep the document itself.
  await deleteExpensesBySource(id);
  d.purgedAt = nowIso();
  d.deletedAt = d.deletedAt || nowIso();
  d.updatedAt = nowIso();
  await put(store, d);
}

/** All trashed (not yet purged) documents, most-recently-deleted first. */
export async function trashedDocs(): Promise<Doc[]> {
  const [q, i] = await Promise.all([allRec<Doc>("quotations"), allRec<Doc>("invoices")]);
  return [...q, ...i]
    .filter(isTrashedDoc)
    .sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
}

/** Purged docs still held in storage — owner can restore them. */
export async function purgedDocs(): Promise<Doc[]> {
  const [q, i] = await Promise.all([allRec<Doc>("quotations"), allRec<Doc>("invoices")]);
  return [...q, ...i]
    .filter((d) => !!d.purgedAt)
    .sort((a, b) => (b.purgedAt || "").localeCompare(a.purgedAt || ""));
}
