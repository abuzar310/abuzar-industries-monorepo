// Robust local-folder mirror (Chrome/Edge desktop, File System Access API).
//
// Connect ONE OR MANY folders (e.g. this Mac's folder + a personal/Dropbox folder). Every
// invoice/quotation is written to ALL connected folders the instant it's created or edited — as a
// re-importable `.json` PLUS a readable `.html` — with a full database snapshot alongside. Handles are
// PERSISTED in IndexedDB (per device) and restored on load with a permission re-check. A durable copy
// independent of the cloud + IndexedDB, so nothing is ever lost.
import { allRec, metaGet, metaSet } from "./db";
import { documentSnapshotHtml, dumpAll } from "./backup";
import type { Doc } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const KEY = "folderHandles";
let handles: any[] = []; // every folder connected on THIS device
const granted = new Set<any>(); // the subset with live read-write permission this session
let lastSnap = 0;

export const folderSupported = () => typeof (globalThis as any).showDirectoryPicker === "function";
export const folderActive = () => granted.size > 0;
export const folderNeedsGrant = () => handles.some((h) => !granted.has(h));

export interface FolderInfo {
  i: number;
  name: string;
  granted: boolean;
}
/** The folders connected on this device, for the Settings list. */
export function folderList(): FolderInfo[] {
  return handles.map((h, i) => ({ i, name: (h && h.name) || "folder", granted: granted.has(h) }));
}

async function perm(handle: any, request: boolean): Promise<boolean> {
  try {
    if (!handle?.queryPermission) return false;
    const o = { mode: "readwrite" as const };
    if ((await handle.queryPermission(o)) === "granted") return true;
    if (request && (await handle.requestPermission(o)) === "granted") return true;
  } catch {}
  return false;
}

async function ensureTree(h: any) {
  for (const d of ["Quotations", "Invoices", "Database"]) await h.getDirectoryHandle(d, { create: true });
}

/** Restore all saved folders on app load. Passive (no user gesture) — only queries permission. */
export async function initFolderMirror(): Promise<void> {
  try {
    handles = (await metaGet<any[]>(KEY, [])) || [];
    granted.clear();
    for (const h of handles) {
      if (await perm(h, false)) {
        granted.add(h);
        try {
          await ensureTree(h);
        } catch {}
      }
    }
  } catch {}
}

/** Add a NEW folder (or re-grant one already picked). MUST be from a user gesture. Returns its name. */
export async function connectFolder(): Promise<string | null> {
  const picker = (globalThis as any).showDirectoryPicker;
  if (!picker) return null;
  let base: any;
  try {
    const root = await picker({ id: "abuzar-mirror", mode: "readwrite" });
    base = await root.getDirectoryHandle("Abuzar Industries", { create: true });
  } catch {
    return null; // user cancelled the picker
  }
  // de-dupe: if this exact folder is already connected, just (re)activate it
  let existing: any = null;
  for (const h of handles) {
    try {
      if (h && h.isSameEntry && (await h.isSameEntry(base))) {
        existing = h;
        break;
      }
    } catch {}
  }
  const h = existing || base;
  if (!existing) {
    handles.push(base);
    await metaSet(KEY, handles);
  }
  granted.add(h);
  await ensureTree(h);
  await mirrorAllTo(h);
  return (h && h.name) || "folder";
}

/** Re-grant permission for a folder already in the list (by index). From a user gesture. */
export async function grantFolder(i: number): Promise<boolean> {
  const h = handles[i];
  if (!h) return false;
  if (await perm(h, true)) {
    granted.add(h);
    await ensureTree(h);
    await mirrorAllTo(h);
    return true;
  }
  return false;
}

/** Remove a folder from auto-save (by index). Files already written stay on disk. */
export async function disconnectFolder(i: number): Promise<void> {
  const h = handles[i];
  if (!h) return;
  granted.delete(h);
  handles.splice(i, 1);
  await metaSet(KEY, handles);
}

async function writeFile(dh: any, name: string, content: string) {
  const fh = await dh.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}
const safeName = (s: string) => String(s || "doc").replace(/[\/\\?#%:*"<>|]/g, "-");

async function writeDocTo(h: any, doc: Doc) {
  const sub = doc.kind === "invoice" ? "Invoices" : "Quotations";
  const dh = await h.getDirectoryHandle(sub, { create: true });
  const name = safeName(doc.number || doc.id);
  await writeFile(dh, name + ".json", JSON.stringify(doc, null, 2)); // complete + re-importable
  await writeFile(dh, name + ".html", documentSnapshotHtml(doc)); // human-readable copy
}

/** Write ONE document to EVERY connected folder immediately (on create/edit). */
export async function mirrorDoc(doc: Doc): Promise<void> {
  if (!doc || granted.size === 0) return;
  const doSnap = Date.now() - lastSnap >= 20000; // throttle the heavy full-DB dump to once / 20s
  let dump: unknown = null;
  if (doSnap) {
    lastSnap = Date.now();
    try {
      dump = await dumpAll();
    } catch {}
  }
  for (const h of granted) {
    try {
      await writeDocTo(h, doc);
      if (dump) {
        const db = await h.getDirectoryHandle("Database", { create: true });
        await writeFile(db, "abuzar-data.json", JSON.stringify(dump, null, 2));
      }
    } catch (e) {
      console.warn("mirrorDoc", e);
    }
  }
}

/** Write every current invoice + quotation to one folder (on first connect / re-grant). */
async function mirrorAllTo(h: any): Promise<void> {
  try {
    const [inv, quo] = await Promise.all([allRec<Doc>("invoices"), allRec<Doc>("quotations")]);
    for (const d of [...inv, ...quo]) {
      try {
        await writeDocTo(h, d);
      } catch {}
    }
    const db = await h.getDirectoryHandle("Database", { create: true });
    await writeFile(db, "abuzar-data.json", JSON.stringify(await dumpAll(), null, 2));
  } catch (e) {
    console.warn("mirrorAllTo", e);
  }
}
