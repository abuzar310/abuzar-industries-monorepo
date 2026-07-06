// IndexedDB layer — the offline-first source of truth. Browser-only.
// Every read/write awaits openDB() first, so callers never race the initial open
// (child effects can run before the AppProvider boot effect).
import type { StoreName } from "./types";

const DB_BASE = "abuzar_industries";
const DB_VER = 6;
export const STORES: StoreName[] = [
  "customers", "quotations", "invoices", "stock", "expenses", "meta",
  "sessions", "ledgers", "vouchers", "collections",
];

// Per-app local database so the two apps never share IndexedDB data.
// Must be set (once, from AppProvider) before openDB() is called.
let dbSuffix = "";
export const setDbSuffix = (s: string) => {
  dbSuffix = (s || "").replace(/[^a-z0-9]/gi, "");
};
const dbName = () => (dbSuffix ? DB_BASE + "_" + dbSuffix : DB_BASE);

let _db: IDBDatabase | null = null;
let _opening: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening; // share one open across concurrent callers
  _opening = new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(dbName(), DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === "stock" ? "key" : s === "meta" ? "k" : "id" });
      }
    };
    r.onsuccess = () => {
      _db = r.result;
      _opening = null;
      res(_db);
    };
    r.onerror = () => {
      _opening = null;
      rej(r.error);
    };
  });
  return _opening;
}

export async function put<T>(s: StoreName, v: T): Promise<T> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(s, "readwrite").objectStore(s).put(v);
    r.onsuccess = () => res(v);
    r.onerror = () => rej(r.error);
  });
}

export async function getRec<T = unknown>(s: StoreName, k: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(s, "readonly").objectStore(s).get(k);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}

export async function delRec(s: StoreName, k: IDBValidKey): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(s, "readwrite").objectStore(s).delete(k);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

export async function allRec<T = unknown>(s: StoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(s, "readonly").objectStore(s).getAll();
    r.onsuccess = () => res((r.result as T[]) || []);
    r.onerror = () => rej(r.error);
  });
}

export async function clearStore(s: StoreName): Promise<void> {
  const db = await openDB();
  return new Promise((res) => {
    const r = db.transaction(s, "readwrite").objectStore(s).clear();
    r.onsuccess = () => res();
    r.onerror = () => res();
  });
}

export async function metaGet<T>(k: string, def: T): Promise<T> {
  const r = await getRec<{ k: string; v: T }>("meta", k);
  return r ? r.v : def;
}

export const metaSet = <T>(k: string, v: T) => put("meta", { k, v });

/** Deep clone for safe IndexedDB writes (mirrors legacy JSON round-trip). */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
