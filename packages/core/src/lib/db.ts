// IndexedDB layer — the offline-first source of truth. Browser-only.
import type { StoreName } from "./types";

const DB_NAME = "abuzar_industries";
const DB_VER = 4;
export const STORES: StoreName[] = [
  "customers", "quotations", "invoices", "stock", "expenses", "meta",
  "vendors", "accounts", "ledger", "sessions",
];

let _db: IDBDatabase | null = null;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (_db) return res(_db);
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("customers")) db.createObjectStore("customers", { keyPath: "id" });
      if (!db.objectStoreNames.contains("quotations")) db.createObjectStore("quotations", { keyPath: "id" });
      if (!db.objectStoreNames.contains("invoices")) db.createObjectStore("invoices", { keyPath: "id" });
      if (!db.objectStoreNames.contains("stock")) db.createObjectStore("stock", { keyPath: "key" });
      if (!db.objectStoreNames.contains("expenses")) db.createObjectStore("expenses", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "k" });
      if (!db.objectStoreNames.contains("vendors")) db.createObjectStore("vendors", { keyPath: "id" });
      if (!db.objectStoreNames.contains("accounts")) db.createObjectStore("accounts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("ledger")) db.createObjectStore("ledger", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
    };
    r.onsuccess = () => {
      _db = r.result;
      res(_db);
    };
    r.onerror = () => rej(r.error);
  });
}

function store(s: StoreName, mode: IDBTransactionMode) {
  if (!_db) throw new Error("DB not open — call openDB() first");
  return _db.transaction(s, mode).objectStore(s);
}

export const put = <T>(s: StoreName, v: T): Promise<T> =>
  new Promise((res, rej) => {
    const r = store(s, "readwrite").put(v);
    r.onsuccess = () => res(v);
    r.onerror = () => rej(r.error);
  });

export const getRec = <T = unknown>(s: StoreName, k: IDBValidKey): Promise<T | undefined> =>
  new Promise((res, rej) => {
    const r = store(s, "readonly").get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

export const delRec = (s: StoreName, k: IDBValidKey): Promise<void> =>
  new Promise((res, rej) => {
    const r = store(s, "readwrite").delete(k);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });

export const allRec = <T = unknown>(s: StoreName): Promise<T[]> =>
  new Promise((res, rej) => {
    const r = store(s, "readonly").getAll();
    r.onsuccess = () => res((r.result as T[]) || []);
    r.onerror = () => rej(r.error);
  });

export const clearStore = (s: StoreName): Promise<void> =>
  new Promise((res) => {
    const r = store(s, "readwrite").clear();
    r.onsuccess = () => res();
    r.onerror = () => res();
  });

export async function metaGet<T>(k: string, def: T): Promise<T> {
  const r = await getRec<{ k: string; v: T }>("meta", k);
  return r ? r.v : def;
}

export const metaSet = <T>(k: string, v: T) => put("meta", { k, v });

/** Deep clone for safe IndexedDB writes (mirrors legacy JSON round-trip). */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
