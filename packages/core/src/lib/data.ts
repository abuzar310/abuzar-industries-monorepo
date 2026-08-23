// Cloud-only client data layer — replaces the old IndexedDB + sync machinery.
// (No "use client" directive: pure client helpers like invoice-id import this and
// are also pulled into the server route graph — the module top-level is SSR-safe.)
//
// How it works:
//   * The database (via /api/data) is the single source of truth.
//   * On boot the client loads EVERYTHING once (/bootstrap) into an in-memory
//     cache, so views read instantly and synchronously from memory.
//   * Every write goes straight to the server through an ordered outbox. The
//     cache is updated optimistically, and if the network drops the outbox
//     retries until it lands — the sync dot shows "Pending" until it does.
//   * A change-poll (/changes?since=…) + focus/online listeners keep every
//     device converged on the same server state within seconds. Deletes arrive
//     as explicit tombstoned change rows from the server, so nothing ever
//     "comes back" and nothing silently disappears.
//
// There is deliberately NO IndexedDB, NO localStorage records, NO client-side
// sync-state reconciliation: none of the old failure modes can exist.
import type { StoreName } from "./types";
import { bumpData, setSyncState } from "@/store/app-store";

export const DATA_STORES: StoreName[] = [
  "customers", "suppliers", "quotations", "invoices", "stock", "expenses",
  "sessions", "ledgers", "vouchers", "collections", "payHolders",
  "workers", "attendance", "activity", "purchases", "websiteQuotations", "carpenters", "chat",
];

// ---- in-memory cache ----

const cache = new Map<StoreName, Map<string, unknown>>();
for (const s of DATA_STORES) cache.set(s, new Map());
let metaCache: Record<string, unknown> = {};
let lastServerNow = ""; // watermark for /changes polling
let booted = false;

const API = "/api/data";

type AnyRec = Record<string, unknown> & { id?: string; key?: string };

const keyOf = (store: StoreName, rec: AnyRec): string =>
  String(store === "stock" ? rec.key ?? rec.id ?? "" : rec.id ?? "");

/** Deep clone so callers can never mutate the cache in place. */
export const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

// ---- low-level fetch ----

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A request that hangs forever (phone switching Wi-Fi↔mobile data mid-flight) must
 *  eventually FAIL — otherwise the poll/outbox in-flight guards never release and the
 *  device silently stops syncing until the app is killed. 20s is generous for any payload. */
const callTimeout = () =>
  typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(20000) : undefined;

async function call<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    credentials: "same-origin",
    cache: "no-store", // always the live server state — never a browser-cached copy
    signal: callTimeout(),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { error?: string }));
    throw new ApiError(r.status, (body as { error?: string }).error || "HTTP " + r.status);
  }
  return (await r.json()) as T;
}

// ---- auth ----

export interface SessionUser {
  id: string;
  name: string;
  role: "owner" | "manager";
}

export async function apiMe(): Promise<SessionUser | null> {
  try {
    const r = await call<{ user: SessionUser | null }>("/auth/me");
    return r.user;
  } catch {
    return null;
  }
}

export async function apiLogin(userId: string, password: string): Promise<SessionUser | null> {
  try {
    const r = await call<{ user: SessionUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId, password }),
    });
    return r.user;
  } catch {
    return null;
  }
}

export async function apiLogout(): Promise<void> {
  await call("/auth/logout", { method: "POST" }).catch(() => {});
}

export async function apiChangePassword(password: string): Promise<boolean> {
  try {
    await call("/auth/password", { method: "POST", body: JSON.stringify({ password }) });
    return true;
  } catch {
    return false;
  }
}

// ---- boot ----

interface Bootstrap {
  user: SessionUser;
  stores: Record<string, AnyRec[]>;
  meta: Record<string, unknown>;
  now: string;
}

/** Load the full dataset from the server into the cache. Requires a session. */
export async function bootData(): Promise<void> {
  const b = await call<Bootstrap>("/bootstrap");
  for (const s of DATA_STORES) {
    const m = new Map<string, unknown>();
    for (const rec of b.stores[s] || []) {
      const k = keyOf(s, rec);
      if (k) m.set(k, rec);
    }
    cache.set(s, m);
  }
  metaCache = b.meta || {};
  lastServerNow = b.now;
  booted = true;
  setSyncState("on");
  bumpData();
}

export const isBooted = () => booted;

/** Drop everything (on logout) so the next user starts from a clean fetch. */
export function resetData(): void {
  for (const s of DATA_STORES) cache.set(s, new Map());
  metaCache = {};
  lastServerNow = "";
  booted = false;
}

// ---- reads (synchronous from cache; async wrappers keep old call shapes) ----

export function listCached<T = unknown>(store: StoreName): T[] {
  return [...(cache.get(store)?.values() || [])] as T[];
}

export function getCached<T = unknown>(store: StoreName, id: string): T | undefined {
  return cache.get(store)?.get(String(id)) as T | undefined;
}

// The async wrappers return CLONES (like the old IndexedDB layer did) — callers
// mutate what they read before put()ing it back, and must never touch the cache.
export async function allRec<T = unknown>(store: StoreName): Promise<T[]> {
  return clone(listCached<T>(store));
}

export async function getRec<T = unknown>(store: StoreName, id: string): Promise<T | undefined> {
  return clone(getCached<T>(store, id));
}

// ---- writes (optimistic cache + ordered, retrying outbox) ----

interface OutboxItem {
  label: string;
  run: () => Promise<void>;
}

const outbox: OutboxItem[] = [];
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** ids with writes still in flight — change-polls must not clobber them. */
const pendingIds = new Set<string>();

const pendKey = (store: StoreName, id: string) => store + ":" + id;
export const hasPendingWrites = () => outbox.length > 0 || flushing;

function enqueue(item: OutboxItem) {
  outbox.push(item);
  void flushOutbox();
}

async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  clearTimeout(retryTimer);
  try {
    while (outbox.length) {
      const item = outbox[0];
      try {
        await item.run();
        outbox.shift();
      } catch (e) {
        if (e instanceof ApiError && e.status !== 401) {
          // The server rejected it (bad request) — drop it and re-converge.
          console.error("[data] write rejected:", item.label, e.message);
          outbox.shift();
          continue;
        }
        // network / auth hiccup — keep it queued and retry shortly
        setSyncState(typeof navigator !== "undefined" && !navigator.onLine ? "off" : "queue");
        retryTimer = setTimeout(() => void flushOutbox(), 3000);
        return;
      }
    }
    setSyncState("on");
  } finally {
    flushing = false;
  }
}

/** Warn before closing a tab that still has unsent writes. */
export function bindUnloadGuard() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", (e) => {
    if (hasPendingWrites()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

/** Save a record: cache immediately, persist to the server (retried until it lands). */
export async function put<T extends object>(store: StoreName, rec: T): Promise<T> {
  const id = keyOf(store, rec as AnyRec);
  if (!id) throw new Error("Record has no id");
  const copy = clone(rec);
  cache.get(store)!.set(id, copy);
  const pk = pendKey(store, id);
  pendingIds.add(pk);
  setSyncState("queue");
  enqueue({
    label: `put ${store}/${id}`,
    run: async () => {
      await call(`/rec/${store}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(cache.get(store)!.get(id) ?? copy),
      });
      pendingIds.delete(pk);
    },
  });
  return rec;
}

/** Delete a record (server keeps it as a tombstone — recoverable, never resurrects). */
export async function delRec(store: StoreName, id: string): Promise<void> {
  const key = String(id);
  cache.get(store)!.delete(key);
  const pk = pendKey(store, key);
  pendingIds.add(pk);
  setSyncState("queue");
  enqueue({
    label: `del ${store}/${key}`,
    run: async () => {
      await call(`/rec/${store}/${encodeURIComponent(key)}`, { method: "DELETE" });
      pendingIds.delete(pk);
    },
  });
}

// ---- shared settings (meta) ----

export async function metaGet<T>(k: string, def: T): Promise<T> {
  const v = metaCache[k];
  return v === undefined || v === null ? def : (v as T);
}

export function metaGetCached<T>(k: string, def: T): T {
  const v = metaCache[k];
  return v === undefined || v === null ? def : (v as T);
}

export async function metaSet<T>(k: string, v: T): Promise<void> {
  metaCache[k] = v;
  setSyncState("queue");
  enqueue({
    label: `meta ${k}`,
    run: async () => {
      await call(`/meta/${encodeURIComponent(k)}`, { method: "PUT", body: JSON.stringify({ v }) });
    },
  });
}

// ---- device-local UI preferences (NOT business data) ----
// Only cosmetic per-device state lives here (e.g. the last-open document id).

export function prefGet<T>(k: string, def: T): T {
  if (typeof localStorage === "undefined") return def;
  try {
    const s = localStorage.getItem("pref:" + k);
    return s == null ? def : (JSON.parse(s) as T);
  } catch {
    return def;
  }
}

export function prefSet<T>(k: string, v: T): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (v == null) localStorage.removeItem("pref:" + k);
    else localStorage.setItem("pref:" + k, JSON.stringify(v));
  } catch {}
}

// ---- change polling (keeps every device converged) ----

interface ChangeRow {
  id: string;
  deleted: boolean;
  data: AnyRec;
}

interface Changes {
  changes: Record<string, ChangeRow[]>;
  meta: Record<string, unknown>;
  now: string;
}

let pulling = false;

/** Pull server changes since the last watermark and fold them into the cache. */
export async function pullChanges(): Promise<boolean> {
  if (!booted || pulling) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  pulling = true;
  try {
    const r = await call<Changes>("/changes?since=" + encodeURIComponent(lastServerNow));
    let changed = false;
    for (const [store, rows] of Object.entries(r.changes || {})) {
      const m = cache.get(store as StoreName);
      if (!m) continue;
      for (const row of rows) {
        if (pendingIds.has(pendKey(store as StoreName, row.id))) continue; // our write is newer
        if (row.deleted) {
          if (m.delete(row.id)) changed = true;
        } else {
          m.set(row.id, row.data);
          changed = true;
        }
      }
    }
    // shared settings can change on other devices too
    const metaNow = JSON.stringify(r.meta || {});
    if (metaNow !== JSON.stringify(metaCache)) {
      // keep values we have pending writes for
      const merged = { ...(r.meta || {}) };
      metaCache = merged;
      changed = true;
    }
    lastServerNow = r.now;
    if (!hasPendingWrites()) setSyncState("on");
    if (changed) bumpData();
    return changed;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e; // session expired — caller handles
    setSyncState(typeof navigator !== "undefined" && !navigator.onLine ? "off" : "queue");
    return false;
  } finally {
    pulling = false;
  }
}

// ---- all-transactions (unified money movement feed, client-side) ----

export interface AllTransaction {
  id: string;
  date: string;
  type: string;
  amount: number;
  party: string;
  partyType: string;
  mode: string;
  note: string;
  enteredBy: string;
  deleted: boolean;
  createdAt: string;
  sourceId?: string;
}

export interface AllTransactionsResponse {
  transactions: AllTransaction[];
  total: number;
  limit: number;
  offset: number;
}

/** Fetch a page of unified transactions from the server. */
export async function fetchAllTransactions(
  limit = 100,
  offset = 0,
  typeFilter = "",
): Promise<AllTransactionsResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (typeFilter) params.set("type", typeFilter);
  return call<AllTransactionsResponse>(`/all-transactions?${params.toString()}`);
}

// ---- atomic document creation (numbering allocated inside the database) ----

export async function rpcCreateDoc<T extends object>(data: T): Promise<T> {
  const r = await call<{ data: T }>("/rpc/create-doc", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
  const doc = r.data;
  const store: StoreName = (doc as AnyRec).kind === "invoice" ? "invoices" : "quotations";
  cache.get(store)!.set(String((doc as AnyRec).id), clone(doc));
  bumpData();
  return doc;
}

export async function rpcNextVoucherNo(type: string): Promise<number> {
  const r = await call<{ n: number }>("/rpc/next-voucher-no", {
    method: "POST",
    body: JSON.stringify({ type }),
  });
  return r.n;
}

/** Next free invoice display number in a series (sell | buy | rent), allocated
 *  atomically by the server — used when an invoice moves between series.
 *  Pass the invoice's own id as `exceptId` so its current number never blocks it. */
export async function rpcNextInvoiceNumber(
  series: "sell" | "buy" | "rent",
  exceptId?: string,
): Promise<string> {
  const r = await call<{ number: string }>("/rpc/next-invoice-number", {
    method: "POST",
    body: JSON.stringify({ series, exceptId }),
  });
  return r.number;
}
