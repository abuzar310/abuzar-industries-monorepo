// Recycle bin — soft-delete for documents. A delete just flags the doc and keeps it (locally + in
// the cloud), so nothing is ever really lost; the owner restores or purges it from Settings.
import { allRec, delRec, getRec, put } from "./db";
import { nowIso } from "./calc";
import { cloudDelete, trySync } from "./cloud";
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
  d.updatedAt = nowIso();
  d.synced = false;
  await put(store, d);
  trySync();
}

/** Permanently remove a trashed doc + its linked daybook entries (hard delete + tombstone).
 *  ponytail: an invoice's auto-posted ledger vouchers aren't unposted here (official app only);
 *  add unpostInvoice() if the ledger ever needs to reconcile on purge. */
export async function purgeDoc(store: DocStore, id: string): Promise<void> {
  await deleteExpensesBySource(id);
  await delRec(store, id);
  await cloudDelete(store, id);
  trySync();
}

/** All trashed documents (quotations + invoices), most-recently-deleted first. */
export async function trashedDocs(): Promise<Doc[]> {
  const [q, i] = await Promise.all([allRec<Doc>("quotations"), allRec<Doc>("invoices")]);
  return [...q, ...i]
    .filter((d) => !!d.deletedAt)
    .sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
}
