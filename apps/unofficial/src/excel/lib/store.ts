// Workbooks live in the unofficial schema (`excelBooks`), same path as every other record.
// Folders are a small meta list. Books without a folder sit in "My sheets".
// A one-shot lift copies leftover on-device books so nothing from IndexedDB is dropped.

import { allRec, delRec, getRec, metaGet, metaSet, put } from "@/lib/data";
import { DEFAULT_FOLDER_ID, folderOf } from "./folder";

export { DEFAULT_FOLDER_ID, folderOf };

export type FolderMeta = { id: string; name: string; savedAt: number };
export type BookMeta = { id: string; name: string; savedAt: number; folderId: string };
export type ExcelBook = BookMeta & { snap: Record<string, unknown> };

/** When a save happened. Module-level keeps component code pure for the compiler lint. */
export const stamp = () => Date.now();
type Snap = Record<string, unknown>;

const STORE = "excelBooks" as const;
const LAST = "excelLastOpen";
const FOLDERS = "excelFolders";

let lifted = false;

function asBook(row: unknown): ExcelBook | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Partial<ExcelBook>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string") return null;
  const savedAt = typeof r.savedAt === "number" ? r.savedAt : Number(r.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  if (!r.snap || typeof r.snap !== "object") return null;
  return { id: r.id, name: r.name, savedAt, folderId: folderOf(r.folderId), snap: r.snap };
}

function asFolder(row: unknown): FolderMeta | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Partial<FolderMeta>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string" || !r.name.trim()) return null;
  const savedAt = typeof r.savedAt === "number" ? r.savedAt : Number(r.savedAt) || 0;
  return { id: r.id, name: r.name.trim(), savedAt };
}

export async function listBooks(): Promise<BookMeta[]> {
  await liftDeviceBooks();
  return (await allRec<ExcelBook>(STORE))
    .map(asBook)
    .filter((r): r is ExcelBook => !!r)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(({ id, name, savedAt, folderId }) => ({ id, name, savedAt, folderId }));
}

export async function listFolders(): Promise<FolderMeta[]> {
  const raw = await metaGet<unknown[]>(FOLDERS, []);
  const extra = (Array.isArray(raw) ? raw : []).map(asFolder).filter((f): f is FolderMeta => !!f);
  if (!extra.some((f) => f.id === DEFAULT_FOLDER_ID)) {
    extra.unshift({ id: DEFAULT_FOLDER_ID, name: "My sheets", savedAt: 0 });
  }
  return extra;
}

export async function addFolder(name: string): Promise<FolderMeta> {
  const folders = await listFolders();
  const folder: FolderMeta = {
    id: "fld-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: name.trim() || "Folder",
    savedAt: stamp(),
  };
  await metaSet(FOLDERS, [...folders, folder]);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  const folders = await listFolders();
  await metaSet(
    FOLDERS,
    folders.map((f) => (f.id === id ? { ...f, name: clean } : f)),
  );
}

export async function deleteFolder(id: string): Promise<void> {
  if (id === DEFAULT_FOLDER_ID) return;
  for (const book of (await listBooks()).filter((b) => b.folderId === id)) {
    const row = await getRec<ExcelBook>(STORE, book.id);
    if (row) await put(STORE, { ...row, folderId: DEFAULT_FOLDER_ID });
  }
  await metaSet(
    FOLDERS,
    (await listFolders()).filter((f) => f.id !== id),
  );
}

export async function loadSnapshot(id: string): Promise<Snap | null> {
  return (await getRec<ExcelBook>(STORE, id))?.snap ?? null;
}

export async function saveBook(meta: BookMeta, snapshot: Snap): Promise<void> {
  const prev = await getRec<ExcelBook>(STORE, meta.id);
  await put(STORE, {
    ...prev,
    id: meta.id,
    name: meta.name,
    savedAt: meta.savedAt,
    folderId: folderOf(meta.folderId || prev?.folderId),
    snap: snapshot,
  });
}

export async function deleteBook(id: string): Promise<void> {
  await delRec(STORE, id);
}

export async function getLastOpen(): Promise<string | null> {
  const id = await metaGet<string>(LAST, "");
  if (id) return id;
  const old = await readIdbLastOpen();
  if (old) await setLastOpen(old);
  return old;
}

export async function setLastOpen(id: string): Promise<void> {
  await metaSet(LAST, id);
}

/** ponytail: one lift; drop the IDB read once every owner has opened Excel once. */
async function liftDeviceBooks(): Promise<void> {
  if (lifted || typeof indexedDB === "undefined") return;
  lifted = true;
  const cloud = (await allRec<ExcelBook>(STORE)).filter(asBook);
  if (cloud.length) return;
  for (const row of await readIdbBooks()) {
    if (!asBook(row)) continue;
    await put(STORE, { ...row, folderId: folderOf(row.folderId) });
  }
}

async function openLegacyDb(): Promise<IDBDatabase | null> {
  try {
    const listed = await indexedDB.databases?.();
    if (listed && !listed.some((d) => d.name === "personal-excel")) return null;
  } catch {
    /* older browsers: try open; onupgradeneeded oldVersion 0 means it never existed */
  }
  return new Promise((resolve) => {
    const r = indexedDB.open("personal-excel");
    r.onupgradeneeded = (e) => {
      if (e.oldVersion === 0) {
        r.transaction?.abort();
        indexedDB.deleteDatabase("personal-excel");
        resolve(null);
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function readIdbBooks(): Promise<ExcelBook[]> {
  const d = await openLegacyDb();
  if (!d || !d.objectStoreNames.contains("books") || !d.objectStoreNames.contains("snaps")) {
    d?.close();
    return [];
  }
  try {
    const metas = (await req(d.transaction("books").objectStore("books").getAll())) as BookMeta[];
    const out: ExcelBook[] = [];
    for (const meta of metas) {
      const row = await req<{ id: string; data: Snap } | undefined>(
        d.transaction("snaps").objectStore("snaps").get(meta.id),
      );
      if (row?.data) out.push({ ...meta, folderId: folderOf(meta.folderId), snap: row.data });
    }
    return out;
  } catch {
    return [];
  } finally {
    d.close();
  }
}

async function readIdbLastOpen(): Promise<string | null> {
  const d = await openLegacyDb();
  if (!d || !d.objectStoreNames.contains("meta")) {
    d?.close();
    return null;
  }
  try {
    return (await req<string | undefined>(d.transaction("meta").objectStore("meta").get("lastOpen"))) ?? null;
  } catch {
    return null;
  } finally {
    d.close();
  }
}
