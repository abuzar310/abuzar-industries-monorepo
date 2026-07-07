// Automatic rolling local backups — a safety net so no bug can permanently lose data. Snapshots the
// data stores into the local `meta` store on a schedule; restore re-creates anything that went missing
// (and re-queues it to sync back to the cloud). Independent of Supabase, so it survives sync bugs.
import { allRec, metaGet, metaSet, put } from "./db";
import { nowIso } from "./calc";
import { clearTombstone, trySync } from "./cloud";
import type { StoreName } from "./types";

// data stores only — never "meta" (that's where the snapshots themselves live)
const SNAP_STORES: StoreName[] = [
  "customers",
  "quotations",
  "invoices",
  "expenses",
  "sessions",
  "stock",
  "ledgers",
  "vouchers",
  "collections",
];
const MAX_SNAPS = 60; // keep a deep history
const MIN_GAP_MS = 60 * 60 * 1000; // time-based auto-snapshot at most once an hour (on load)
const MIN_BEFORE_GAP_MS = 2 * 60 * 1000; // before a risky op: snapshot unless one was taken in the last 2 min

export interface Snapshot {
  at: string;
  total: number;
  data: Record<string, Record<string, unknown>[]>;
}

const loadList = () => metaGet<Snapshot[]>("autobackups", []);

/** Take a snapshot now. Returns null (no write) if there's nothing to back up. */
export async function autoSnapshot(): Promise<Snapshot | null> {
  const data: Record<string, Record<string, unknown>[]> = {};
  let total = 0;
  for (const s of SNAP_STORES) {
    const recs = (await allRec(s)) as Record<string, unknown>[];
    data[s] = recs;
    total += recs.length;
  }
  if (!total) return null;
  const snap: Snapshot = { at: nowIso(), total, data };
  const list = await loadList();
  list.unshift(snap);
  await metaSet("autobackups", list.slice(0, MAX_SNAPS));
  return snap;
}

/** Snapshot only if the last one is older than the min gap (safe to call on every app load). */
export async function maybeAutoSnapshot(): Promise<void> {
  const list = await loadList();
  const last = list[0]?.at;
  if (last && Date.now() - new Date(last).getTime() < MIN_GAP_MS) return;
  await autoSnapshot().catch(() => {});
}

/** Take a snapshot right before a risky/destructive action, unless one was just taken (dedup) — so
 *  there's always a fresh restore point captured moments before a delete. */
export async function snapshotBefore(): Promise<void> {
  const list = await loadList();
  const last = list[0]?.at;
  if (last && Date.now() - new Date(last).getTime() < MIN_BEFORE_GAP_MS) return;
  await autoSnapshot().catch(() => {});
}

/** Snapshot list without the heavy payload (for the Settings UI). */
export async function listSnapshots(): Promise<{ at: string; total: number }[]> {
  return (await loadList()).map((s) => ({ at: s.at, total: s.total }));
}

/** Restore every record from a snapshot — recovers anything deleted/overwritten since — and re-queues
 *  it to sync back to the cloud. Additive: records created after the snapshot are left untouched.
 *  Returns how many records were restored. */
export async function restoreSnapshot(at: string): Promise<number> {
  const snap = (await loadList()).find((s) => s.at === at);
  if (!snap) return 0;
  let n = 0;
  for (const [store, recs] of Object.entries(snap.data)) {
    for (const rec of recs) {
      const id = String((rec.id ?? rec.key) || "");
      if (!id) continue;
      rec.synced = false; // re-push to the cloud
      await put(store as StoreName, rec);
      await clearTombstone(store, id); // don't let a stale tombstone re-delete it
      n++;
    }
  }
  trySync();
  return n;
}

/** Download a snapshot as a .json file the user can keep off-device. */
export async function downloadSnapshot(at: string): Promise<void> {
  const snap = (await loadList()).find((s) => s.at === at);
  if (!snap) return;
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "autobackup-" + snap.at.slice(0, 19).replace(/[:T]/g, "-") + ".json";
  a.click();
}
