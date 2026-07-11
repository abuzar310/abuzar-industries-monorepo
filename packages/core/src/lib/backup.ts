// Manual backup (.json export/import) over the in-memory cloud cache.
import { DATA_STORES, listCached, put } from "./data";
import { nowIso } from "./calc";
import type { StoreName } from "./types";

export interface Backup {
  meta: { exportedAt: string; app: string };
  [store: string]: unknown;
}

export async function dumpAll(): Promise<Backup> {
  const out: Backup = { meta: { exportedAt: nowIso(), app: "Abuzar Industries" } };
  for (const s of DATA_STORES) out[s] = listCached(s);
  return out;
}

export async function exportBackup() {
  const data = await dumpAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "abuzar-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
}

/** Import a backup file: every record is upserted to the cloud (nothing is deleted). */
export async function importBackup(file: File) {
  const data = JSON.parse(await file.text());
  for (const s of DATA_STORES) {
    if (Array.isArray(data[s])) {
      for (const v of data[s]) await put(s as StoreName, v as Record<string, unknown>);
    }
  }
}
