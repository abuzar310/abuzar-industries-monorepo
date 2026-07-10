// Recycle bin — soft-delete for documents. A delete just flags the doc and keeps it (locally + in
// the cloud), so nothing is ever really lost; the owner restores or purges it from Settings.
//
// DURABILITY: purge no longer hard-DELETEs from the cloud. It only sets purgedAt. That stops the
// cross-device wipe that happened when one device purged and realtime DELETE removed the row
// everywhere. See durability.ts.
import { allRec, getRec, put } from "./db";
import { nowIso } from "./calc";
import { trySync } from "./cloud";
import { snapshotBefore } from "./autobackup";
import { isTrashedDoc } from "./durability";
import { deleteExpensesBySource } from "./expenses";
import type { Doc, DocStore } from "./types";

/** Move a document to the Recycle bin (soft-delete). Not hard-deleted, so it's always recoverable. */
export async function trashDoc(store: DocStore, id: string): Promise<void> {
  const d = await getRec<Doc>(store, id);
  if (!d) return;
  d.deletedAt = nowIso();
  d.updatedAt = nowIso();
  d.synced = false;
  await put(store, d);
  trySync();
}

/** Restore a doc from the Recycle bin back into its list. */
export async function restoreDoc(store: DocStore, id: string): Promise<void> {
  const d = await getRec<Doc>(store, id);
  if (!d) return;
  delete d.deletedAt;
  delete d.purgedAt; // also un-purge if recovering from archive
  d.updatedAt = nowIso();
  d.synced = false;
  await put(store, d);
  trySync();
}

/** Mark a trashed doc as purged — hidden from the bin, but the row STAYS in local + cloud forever.
 *  Never calls cloud DELETE (that was a data-loss vector across devices). Recover via restoreDoc. */
export async function purgeDoc(store: DocStore, id: string): Promise<void> {
  const d = await getRec<Doc>(store, id);
  if (!d) return;
  await snapshotBefore();
  // Drop linked daybook lines (those are regenerable); keep the document itself.
  await deleteExpensesBySource(id);
  d.purgedAt = nowIso();
  d.deletedAt = d.deletedAt || nowIso();
  d.updatedAt = nowIso();
  d.synced = false;
  await put(store, d);
  trySync();
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
