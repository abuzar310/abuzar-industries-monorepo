// Robust local-folder mirror (Chrome/Edge desktop, File System Access API).
//
// Connect ONE OR MANY folders. Each folder has a SCOPE — "both", "invoices" only, or "quotations"
// only — so you can point invoices at one folder and quotations at another (or one folder for all).
// Every doc is written to every matching folder the instant it's created or edited — as a
// re-importable `.json` PLUS a readable `.html` — with a full database snapshot alongside. Handles are
// PERSISTED in IndexedDB (per device) and restored on load with a permission re-check. A durable copy
// independent of the cloud + IndexedDB, so nothing is ever lost.
import { allRec, metaGet, metaSet } from "./db";
import { documentSnapshotHtml, dumpAll } from "./backup";
import type { Doc } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type FolderScope = "both" | "invoices" | "quotations";
interface Entry {
  h: any;
  scope: FolderScope;
}

const KEY = "folderHandles";
let entries: Entry[] = []; // every folder connected on THIS device, with its scope
const granted = new Set<any>(); // the subset of handles with live read-write permission this session
let lastSnap = 0;

export const folderSupported = () => typeof (globalThis as any).showDirectoryPicker === "function";
export const folderActive = () => entries.some((e) => granted.has(e.h));
export const folderNeedsGrant = () => entries.some((e) => !granted.has(e.h));
/** Is a granted folder connected that covers this document kind ("invoice" | "quotation")? */
export const folderActiveFor = (kind: string) => entries.some((e) => granted.has(e.h) && scopeAllows(e.scope, kind));

export interface FolderInfo {
  i: number;
  name: string;
  granted: boolean;
  scope: FolderScope;
}
export function folderList(): FolderInfo[] {
  return entries.map((e, i) => ({ i, name: (e.h && e.h.name) || "folder", granted: granted.has(e.h), scope: e.scope }));
}

const scopeAllows = (scope: FolderScope, kind: string) =>
  scope === "both" || (scope === "invoices" ? kind === "invoice" : kind !== "invoice");

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

/** Migrate stored data: old versions saved a bare array of handles (implicitly scope "both"). */
function normalise(raw: any[]): Entry[] {
  return (raw || [])
    .map((x) => (x && x.h ? { h: x.h, scope: (x.scope as FolderScope) || "both" } : { h: x, scope: "both" as FolderScope }))
    .filter((e) => !!e.h);
}

/** Restore all saved folders on app load. Passive (no user gesture) — only queries permission. */
export async function initFolderMirror(): Promise<void> {
  try {
    entries = normalise((await metaGet<any[]>(KEY, [])) || []);
    granted.clear();
    for (const e of entries) {
      if (await perm(e.h, false)) {
        granted.add(e.h);
        try {
          await ensureTree(e.h);
        } catch {}
      }
    }
  } catch {}
}

/** Add a NEW folder with a scope (or re-grant / re-scope one already picked). From a user gesture. */
export async function connectFolder(scope: FolderScope = "both"): Promise<string | null> {
  const picker = (globalThis as any).showDirectoryPicker;
  if (!picker) return null;
  let base: any;
  try {
    const root = await picker({ id: "abuzar-mirror", mode: "readwrite" });
    base = await root.getDirectoryHandle("Abuzar Industries", { create: true });
  } catch {
    return null; // user cancelled the picker
  }
  // de-dupe: if this exact folder is already connected, re-use it and update its scope
  let existing: Entry | null = null;
  for (const e of entries) {
    try {
      if (e.h && e.h.isSameEntry && (await e.h.isSameEntry(base))) {
        existing = e;
        break;
      }
    } catch {}
  }
  const h = existing ? existing.h : base;
  if (existing) existing.scope = scope;
  else entries.push({ h: base, scope });
  await metaSet(KEY, entries);
  granted.add(h);
  await ensureTree(h);
  await mirrorAllTo(h, scope);
  return (h && h.name) || "folder";
}

/** Re-grant permission for a folder already in the list (by index). From a user gesture. */
export async function grantFolder(i: number): Promise<boolean> {
  const e = entries[i];
  if (!e) return false;
  if (await perm(e.h, true)) {
    granted.add(e.h);
    await ensureTree(e.h);
    await mirrorAllTo(e.h, e.scope);
    return true;
  }
  return false;
}

/** Remove a folder from auto-save (by index). Files already written stay on disk. */
export async function disconnectFolder(i: number): Promise<void> {
  const e = entries[i];
  if (!e) return;
  granted.delete(e.h);
  entries.splice(i, 1);
  await metaSet(KEY, entries);
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
async function snapshotTo(h: any, dump: unknown) {
  const db = await h.getDirectoryHandle("Database", { create: true });
  await writeFile(db, "abuzar-data.json", JSON.stringify(dump, null, 2));
}

/** Write ONE document to every matching connected folder immediately (on create/edit). */
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
  for (const e of entries) {
    if (!granted.has(e.h) || !scopeAllows(e.scope, doc.kind)) continue;
    try {
      await writeDocTo(e.h, doc);
      if (dump) await snapshotTo(e.h, dump);
    } catch (err) {
      console.warn("mirrorDoc", err);
    }
  }
}

/** Write every current doc that matches the folder's scope (on first connect / re-grant). */
async function mirrorAllTo(h: any, scope: FolderScope): Promise<void> {
  try {
    const want: Doc[] = [];
    if (scope !== "quotations") want.push(...(await allRec<Doc>("invoices")));
    if (scope !== "invoices") want.push(...(await allRec<Doc>("quotations")));
    for (const d of want) {
      try {
        await writeDocTo(h, d);
      } catch {}
    }
    await snapshotTo(h, await dumpAll());
  } catch (e) {
    console.warn("mirrorAllTo", e);
  }
}
