// Robust local-folder mirror (Chrome/Edge desktop, File System Access API).
//
// Once you pick a folder, EVERY invoice/quotation is written to disk the moment it's created or
// edited — as a re-importable `.json` PLUS a readable `.html` — and the whole database is snapshotted
// alongside. The chosen folder handle is PERSISTED in IndexedDB, so it survives reloads; on load we
// re-check the OS permission and, if it needs one click to re-grant, we surface that. This is a
// durable copy independent of the cloud and IndexedDB, so nothing is ever lost.
import { allRec, metaGet, metaSet } from "./db";
import { documentSnapshotHtml, dumpAll } from "./backup";
import type { Doc } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const KEY = "folderHandle";
let dirHandle: any = null; // active, permission-granted handle
let savedHandle: any = null; // persisted handle that still needs a permission re-grant (one click)
let lastSnap = 0;

export const folderActive = () => !!dirHandle;
export const folderNeedsGrant = () => !dirHandle && !!savedHandle;
export const folderSupported = () => typeof (globalThis as any).showDirectoryPicker === "function";

async function perm(handle: any, request: boolean): Promise<boolean> {
  try {
    if (!handle?.queryPermission) return false;
    const o = { mode: "readwrite" as const };
    if ((await handle.queryPermission(o)) === "granted") return true;
    if (request && (await handle.requestPermission(o)) === "granted") return true;
  } catch {}
  return false;
}

async function ensureTree() {
  if (!dirHandle) return;
  for (const d of ["Quotations", "Invoices", "Database"]) await dirHandle.getDirectoryHandle(d, { create: true });
}

/** Restore the saved folder on app load. Passive (no user gesture) — only queries permission. */
export async function initFolderMirror(): Promise<void> {
  try {
    const saved = await metaGet<any>(KEY, null);
    if (!saved) return;
    savedHandle = saved;
    if (await perm(saved, false)) {
      dirHandle = saved;
      savedHandle = null;
      await ensureTree();
    }
  } catch {}
}

/** Pick a new folder OR re-authorize the saved one. MUST be called from a user gesture (a click). */
export async function connectFolder(): Promise<boolean> {
  // re-grant the previously chosen folder without re-picking it
  if (savedHandle && (await perm(savedHandle, true))) {
    dirHandle = savedHandle;
    savedHandle = null;
    await ensureTree();
    await mirrorAll();
    return true;
  }
  const picker = (globalThis as any).showDirectoryPicker;
  if (!picker) return false;
  let base: any;
  try {
    const root = await picker({ id: "abuzar-mirror", mode: "readwrite" });
    base = await root.getDirectoryHandle("Abuzar Industries", { create: true });
  } catch {
    return false; // user cancelled the picker
  }
  dirHandle = base;
  savedHandle = null;
  await metaSet(KEY, base);
  await ensureTree();
  await mirrorAll();
  return true;
}

export async function disconnectFolder(): Promise<void> {
  dirHandle = null;
  savedHandle = null;
  await metaSet(KEY, null);
}

async function writeFile(dh: any, name: string, content: string) {
  const fh = await dh.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

const safeName = (s: string) => String(s || "doc").replace(/[\/\\?#%:*"<>|]/g, "-");

async function writeDocFiles(doc: Doc) {
  const sub = doc.kind === "invoice" ? "Invoices" : "Quotations";
  const dh = await dirHandle.getDirectoryHandle(sub, { create: true });
  const name = safeName(doc.number || doc.id);
  await writeFile(dh, name + ".json", JSON.stringify(doc, null, 2)); // complete + re-importable
  await writeFile(dh, name + ".html", documentSnapshotHtml(doc)); // human-readable copy
}

/** Snapshot the whole DB to Database/abuzar-data.json. Throttled to once / 20s unless forced. */
export async function writeDbSnapshot(force = false): Promise<void> {
  if (!dirHandle) return;
  if (!force && Date.now() - lastSnap < 20000) return;
  lastSnap = Date.now();
  try {
    const db = await dirHandle.getDirectoryHandle("Database", { create: true });
    await writeFile(db, "abuzar-data.json", JSON.stringify(await dumpAll(), null, 2));
  } catch (e) {
    console.warn("folder db snapshot", e);
  }
}

/** Write ONE document to disk immediately (on create/edit). No-op if no folder is connected. */
export async function mirrorDoc(doc: Doc): Promise<void> {
  if (!dirHandle || !doc) return;
  try {
    await writeDocFiles(doc);
    await writeDbSnapshot();
  } catch (e) {
    console.warn("mirrorDoc", e);
  }
}

/** Write every current invoice + quotation to disk (on first connect / re-authorize). */
export async function mirrorAll(): Promise<void> {
  if (!dirHandle) return;
  try {
    const [inv, quo] = await Promise.all([allRec<Doc>("invoices"), allRec<Doc>("quotations")]);
    for (const d of [...inv, ...quo]) {
      try {
        await writeDocFiles(d);
      } catch {}
    }
    await writeDbSnapshot(true);
  } catch (e) {
    console.warn("mirrorAll", e);
  }
}
