// On-device workbook storage. IndexedDB, no library: three stores in one database.
// "books" holds the small rows the Books list reads; "snaps" holds the full workbook
// snapshots so listing many books never loads their contents; "meta" holds last-open.

export type BookMeta = { id: string; name: string; savedAt: number };

/** When a save happened. Module-level keeps component code pure for the compiler lint. */
export const stamp = () => Date.now();
type Snap = Record<string, unknown>;

const DB = "personal-excel";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("books")) d.createObjectStore("books", { keyPath: "id" });
      if (!d.objectStoreNames.contains("snaps")) d.createObjectStore("snaps", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listBooks(): Promise<BookMeta[]> {
  const d = await openDb();
  const rows = (await req(d.transaction("books").objectStore("books").getAll())) as BookMeta[];
  d.close();
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadSnapshot(id: string): Promise<Snap | null> {
  const d = await openDb();
  const row = await req<{ id: string; data: Snap } | undefined>(d.transaction("snaps").objectStore("snaps").get(id));
  d.close();
  return row ? row.data : null;
}

/** One transaction writes the row and the snapshot together, so a crash never splits them. */
export async function saveBook(meta: BookMeta, snapshot: Snap): Promise<void> {
  const d = await openDb();
  const tx = d.transaction(["books", "snaps"], "readwrite");
  tx.objectStore("books").put(meta);
  tx.objectStore("snaps").put({ id: meta.id, data: snapshot });
  await done(tx);
  d.close();
}

export async function deleteBook(id: string): Promise<void> {
  const d = await openDb();
  const tx = d.transaction(["books", "snaps", "meta"], "readwrite");
  tx.objectStore("books").delete(id);
  tx.objectStore("snaps").delete(id);
  await done(tx);
  d.close();
}

export async function getLastOpen(): Promise<string | null> {
  const d = await openDb();
  const id = await req<string | undefined>(d.transaction("meta").objectStore("meta").get("lastOpen"));
  d.close();
  return id ?? null;
}

export async function setLastOpen(id: string): Promise<void> {
  const d = await openDb();
  const tx = d.transaction("meta", "readwrite");
  tx.objectStore("meta").put(id, "lastOpen");
  await done(tx);
  d.close();
}
