// Workbooks live in the unofficial schema (`excelBooks`), same path as every other record.
// A one-shot lift copies any leftover on-device books so opening Excel after this
// change does not drop what was already saved in IndexedDB.

import { allRec, delRec, getRec, metaGet, metaSet, put } from "@/lib/data";

export type BookMeta = { id: string; name: string; savedAt: number };
export type ExcelBook = BookMeta & { snap: Record<string, unknown> };

/** When a save happened. Module-level keeps component code pure for the compiler lint. */
export const stamp = () => Date.now();
type Snap = Record<string, unknown>;

const STORE = "excelBooks" as const;
const LAST = "excelLastOpen";

let lifted = false;

function asBook(row: unknown): ExcelBook | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Partial<ExcelBook>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string") return null;
  const savedAt = typeof r.savedAt === "number" ? r.savedAt : Number(r.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  if (!r.snap || typeof r.snap !== "object") return null;
  return { id: r.id, name: r.name, savedAt, snap: r.snap };
}

export async function listBooks(): Promise<BookMeta[]> {
  await liftDeviceBooks();
  return (await allRec<ExcelBook>(STORE))
    .map(asBook)
    .filter((r): r is ExcelBook => !!r)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map(({ id, name, savedAt }) => ({ id, name, savedAt }));
}

export async function loadSnapshot(id: string): Promise<Snap | null> {
  return (await getRec<ExcelBook>(STORE, id))?.snap ?? null;
}

export async function saveBook(meta: BookMeta, snapshot: Snap): Promise<void> {
  await put(STORE, { ...meta, snap: snapshot });
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
    await put(STORE, row);
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
      if (row?.data) out.push({ ...meta, snap: row.data });
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
