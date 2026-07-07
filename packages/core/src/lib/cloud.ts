// Supabase cloud sync + GoTrue auth — hand-rolled REST against {id, data jsonb,
// updated_at} tables, faithfully ported from the legacy single-file app.
import { allRec, getRec, metaGet, metaSet, put } from "./db";
import { nowIso, pad } from "./calc";
import { fixCounters } from "./numbering";
import { BAKED } from "./constants";
import { docStore } from "./doc";
import type { AuthSession, Doc, SupaConfig, SyncState } from "./types";

// ---- module state (mirrors the legacy `supa` / `auth` globals) ----
let supa: SupaConfig = { url: "", key: "" };
let auth: AuthSession = { token: "", refresh: "", email: "", exp: 0 };

export const getSupa = () => supa;
export const getAuth = () => auth;
export const isLoggedIn = () => !!auth.token;

// Currently-open document, so background pulls never clobber what's being edited.
let _openId = "";
let _openStore = "";
export function setOpenDoc(id: string, store: string) {
  _openId = id || "";
  _openStore = store || "";
}

// ---- UI callbacks (bound by the app store) ----
type Callbacks = {
  sync: (s: SyncState) => void;
  needLogin: () => void;
  dataChanged: () => void;
};
let cb: Callbacks = { sync: () => {}, needLogin: () => {}, dataChanged: () => {} };
export function bindCloud(partial: Partial<Callbacks>) {
  cb = { ...cb, ...partial };
}
const setSync = (s: SyncState) => cb.sync(s);

export const TABLE = {
  customers: "customers",
  quotations: "quotations",
  invoices: "invoices",
  stock: "stock",
  expenses: "expenses",
  sessions: "sessions",
  ledgers: "ledgers",
  vouchers: "vouchers",
  collections: "collections",
  payHolders: "payHolders",
} as const;

// Per-app cloud namespace so the two apps never share tables (e.g. "sf_" for Safa).
let cloudPrefix = "";
export const setCloudPrefix = (p: string) => {
  cloudPrefix = p || "";
};
export const getCloudPrefix = () => cloudPrefix;
/** Actual Supabase table name for a store, with the per-app prefix applied. */
export const tableName = (s: string) => cloudPrefix + (TABLE[s as keyof typeof TABLE] || s);

export function cleanSupaUrl(u: string): string {
  u = (u || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "").replace(/\/+$/, "");
}

export async function loadSupa(): Promise<SupaConfig> {
  const saved = await metaGet<SupaConfig | null>("supabase", null);
  supa = saved || { url: "", key: "" };
  if (!supa || !supa.url || !supa.key) {
    if (BAKED.url && BAKED.key) {
      supa = {
        url: cleanSupaUrl(BAKED.url),
        key: String(BAKED.key).trim(),
        secure: (supa && supa.secure) || !!BAKED.secure,
        openLock: (supa && supa.openLock) || BAKED.openLock || "daily",
      };
      await metaSet("supabase", supa);
    } else {
      supa = supa || { url: "", key: "", secure: false, openLock: "daily" };
    }
  }
  if (!supa.openLock) supa.openLock = supa.lockOnOpen ? "always" : BAKED.openLock || "daily";
  const fixed = cleanSupaUrl(supa.url);
  if (fixed !== supa.url) {
    supa.url = fixed;
    await metaSet("supabase", supa);
  }
  return supa;
}

export async function saveSupa(next: SupaConfig) {
  supa = {
    url: cleanSupaUrl(next.url),
    key: (next.key || "").trim(),
    secure: !!next.secure,
    openLock: next.openLock || "daily",
  };
  await metaSet("supabase", supa);
  return supa;
}

export async function setSecure(secure: boolean) {
  supa.secure = secure;
  await metaSet("supabase", supa);
}

export async function setOpenLock(mode: "never" | "daily" | "always") {
  supa.openLock = mode;
  if (mode !== "never" && !supa.secure) supa.secure = true;
  supa.lockOnOpen = mode === "always";
  await metaSet("supabase", supa);
}

export function supaHeaders(): Record<string, string> {
  const k = (supa.key || "").trim();
  const h: Record<string, string> = {
    apikey: k,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };
  if (auth.token) h["Authorization"] = "Bearer " + auth.token;
  else if (k) h["Authorization"] = "Bearer " + k; // anon: legacy JWT or new sb_publishable_ key
  return h;
}

// ---- auth (GoTrue email/password) ----
export async function authLoad() {
  auth = await metaGet<AuthSession>("auth", { token: "", refresh: "", email: "", exp: 0 });
  return auth;
}

export async function signIn(email: string, password: string): Promise<{ ok: boolean; msg?: string }> {
  if (!supa.url || !supa.key) return { ok: false, msg: "Set up Supabase first" };
  try {
    const r = await fetch(supa.url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: supa.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) {
      auth = {
        token: j.access_token,
        refresh: j.refresh_token || "",
        email: (j.user && j.user.email) || email.trim(),
        exp: Date.now() + (j.expires_in || 3600) * 1000,
      };
      await metaSet("auth", auth);
      return { ok: true };
    }
    return { ok: false, msg: j.error_description || j.msg || j.error || "HTTP " + r.status };
  } catch {
    return { ok: false, msg: "Could not reach Supabase" };
  }
}

export async function refreshAuth(): Promise<boolean> {
  if (!auth.refresh || !supa.url) return false;
  try {
    const r = await fetch(supa.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: supa.key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: auth.refresh }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) {
      auth = {
        token: j.access_token,
        refresh: j.refresh_token || auth.refresh,
        email: auth.email,
        exp: Date.now() + (j.expires_in || 3600) * 1000,
      };
      await metaSet("auth", auth);
      return true;
    }
  } catch {}
  return false;
}

export async function ensureAuth() {
  if (auth.token && Date.now() > auth.exp - 60000) await refreshAuth();
}

export async function signOut() {
  auth = { token: "", refresh: "", email: "", exp: 0 };
  await metaSet("auth", auth);
}

export const dayKey = () => {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

export function sessionMode(): "never" | "daily" | "always" {
  if (supa.openLock === "always" || supa.openLock === "daily" || supa.openLock === "never")
    return supa.openLock;
  return supa.lockOnOpen ? "always" : "daily";
}

export const authRequired = () => !!supa.secure;
export const gateStrict = () => !!supa.secure || sessionMode() !== "never";

// ---- record sync ----
export async function trySync(force?: boolean) {
  if (!supa.url || !supa.key) return setSync("local");
  if (!navigator.onLine) return setSync("off");
  if (authRequired() && !isLoggedIn()) {
    setSync("queue");
    cb.needLogin();
    return;
  }
  await ensureAuth();
  let pending = 0;
  let ok = 0;
  let authErr = false;
  for (const s of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
    const arr = await allRec<Doc & { key?: string }>(s);
    for (const rec of arr) {
      if (rec.synced && !force) continue;
      try {
        const body = JSON.stringify([
          { id: rec.id || rec.key, data: rec, updated_at: rec.updatedAt || nowIso() },
        ]);
        const r = await fetch(supa.url + "/rest/v1/" + tableName(s), {
          method: "POST",
          headers: supaHeaders(),
          body,
        });
        if (r.ok) {
          rec.synced = true;
          await put(s, rec);
          ok++;
        } else if (r.status === 404) {
          // Cloud table not set up yet (a newer store on an older DB). Skip the whole
          // store this round so a missing table never wedges the sync indicator — these
          // records stay local and sync automatically once the table exists.
          break;
        } else if (r.status === 401 || r.status === 403) {
          authErr = true;
          pending++;
        } else {
          pending++;
        }
      } catch {
        pending++; // network hiccup — stay queued
      }
    }
  }
  if (authErr) {
    setSync("queue");
    if (authRequired()) {
      await signOut();
      cb.needLogin();
    }
    return;
  }
  setSync(pending === 0 ? "on" : ok ? "on" : "queue");
}

// ---- delete tombstones ----
// A local delete records a tombstone so an in-flight pull can't re-add the record
// before the cloud DELETE lands (that's the "deleted thing comes back" bug). Pruned
// after 14 days (cloud delete is long done by then).
let tombstones: Record<string, number> = {};
const tombKey = (s: string, id: string) => s + ":" + id;
export const isTombstoned = (s: string, id: string) => !!tombstones[tombKey(s, id)];
export async function loadTombstones() {
  const t = await metaGet<Record<string, number>>("tombstones", {});
  const cutoff = Date.now() - 14 * 864e5;
  tombstones = {};
  for (const [k, ts] of Object.entries(t)) if (ts > cutoff) tombstones[k] = ts;
  await metaSet("tombstones", tombstones);
}
async function addTombstone(s: string, id: string) {
  tombstones[tombKey(s, id)] = Date.now();
  await metaSet("tombstones", tombstones);
}
/** Forget a tombstone so a restored/re-created record isn't blocked from syncing back. */
export async function clearTombstone(s: string, id: string) {
  if (tombstones[tombKey(s, id)] === undefined) return;
  delete tombstones[tombKey(s, id)];
  await metaSet("tombstones", tombstones);
}

/** Pull others' changes without disturbing the open document. */
export async function bgPull(openDocId: string = _openId, openDocStore: string = _openStore) {
  if (!supa.url || !supa.key || !navigator.onLine) return;
  if (authRequired() && !isLoggedIn()) return;
  await ensureAuth();
  let changed = false;
  for (const s of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
    try {
      const r = await fetch(supa.url + "/rest/v1/" + tableName(s) + "?select=*", { headers: supaHeaders() });
      if (!r.ok) continue;
      const rows = await r.json();
      for (const row of rows) {
        const rec = row && row.data;
        if (!rec) continue;
        const key = s === "stock" ? rec.key : rec.id;
        if (!key) continue;
        if (isTombstoned(s, key)) continue; // locally deleted — don't resurrect it
        if (openDocId && openDocId === key && openDocStore === s) continue; // never clobber the open doc
        let local: (Doc & { updatedAt?: string }) | undefined;
        try {
          local = await getRec(s, key);
        } catch {}
        const cloudT = row.updated_at || rec.updatedAt || "";
        const localT = (local && local.updatedAt) || "";
        if (!local || cloudT > localT) {
          rec.synced = true;
          await put(s, rec);
          changed = true;
        }
      }
    } catch {}
  }
  if (changed) cb.dataChanged();
}

/** Pull everything down (new device / restore). Returns records pulled. */
export async function pullFromCloud(force?: boolean): Promise<number> {
  if (!supa.url || !supa.key) return 0;
  if (!navigator.onLine) return 0;
  if (authRequired() && !isLoggedIn()) {
    cb.needLogin();
    return 0;
  }
  await ensureAuth();
  let pulled = 0;
  for (const s of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
    try {
      const r = await fetch(supa.url + "/rest/v1/" + tableName(s) + "?select=*", { headers: supaHeaders() });
      if (!r.ok) continue;
      const rows = await r.json();
      for (const row of rows) {
        const rec = row && row.data;
        if (!rec) continue;
        const key = s === "stock" ? rec.key : rec.id;
        if (!key) continue;
        if (!force && isTombstoned(s, key)) continue; // locally deleted — don't resurrect it
        let local: (Doc & { updatedAt?: string }) | undefined;
        try {
          local = await getRec(s, key);
        } catch {}
        const cloudT = row.updated_at || rec.updatedAt || "";
        const localT = (local && local.updatedAt) || "";
        if (force || !local || cloudT >= localT) {
          rec.synced = true;
          await put(s, rec);
          pulled++;
        }
      }
    } catch {}
  }
  await fixCounters();
  return pulled;
}

/** Cloud is the single source of truth: pull everything AND drop local records the
 *  cloud no longer has (so every device converges to the same set). Pending local
 *  writes (synced:false, not yet pushed) are kept so nothing you just made is lost. */
export async function mirrorFromCloud(): Promise<boolean> {
  if (!supa.url || !supa.key || !navigator.onLine) return false;
  if (authRequired() && !isLoggedIn()) return false;
  try {
    await ensureAuth();
  } catch {}
  let ok = false;
  for (const s of Object.keys(TABLE) as (keyof typeof TABLE)[]) {
    try {
      const r = await fetch(supa.url + "/rest/v1/" + tableName(s) + "?select=*", { headers: supaHeaders() });
      if (!r.ok) continue;
      const rows = await r.json();
      if (!Array.isArray(rows)) continue;
      const cloudIds = new Set<string>();
      for (const row of rows) {
        const rec = row && row.data;
        if (!rec) continue;
        const key = s === "stock" ? rec.key : rec.id;
        if (!key) continue;
        cloudIds.add(String(key));
        if (isTombstoned(s, key)) continue;
        rec.synced = true;
        await put(s, rec);
      }
      // DATA-SAFETY POLICY: we NEVER auto-delete a local record just because it's missing from the
      // cloud response. A record only ever leaves by an explicit user action — moving it to the
      // Recycle bin (a soft-delete that syncs as an update, so it's still there in the bin) or purging
      // it. This guarantees no sync glitch, partial fetch, or other device can make a record silently
      // disappear. (Was: converge-delete, which occasionally wiped freshly-created records.)
      ok = true;
    } catch {}
  }
  if (ok) cb.dataChanged();
  return ok;
}

export async function cloudDelete(storeName: string, id: string) {
  await addTombstone(storeName, id); // guard against a pull resurrecting it, even if offline
  if (!supa.url || !supa.key) return;
  try {
    await ensureAuth();
    await fetch(
      supa.url + "/rest/v1/" + tableName(storeName) + "?id=eq." + encodeURIComponent(id),
      { method: "DELETE", headers: supaHeaders() },
    );
  } catch {}
}

export async function cloudClear(tables: (keyof typeof TABLE)[]): Promise<{ ok: boolean; failed: string[] }> {
  if (!supa.url || !supa.key) return { ok: false, failed: ["(no cloud configured)"] };
  try {
    await ensureAuth();
  } catch {}
  const failed: string[] = [];
  for (const s of tables) {
    const tbl = tableName(s);
    try {
      const r = await fetch(supa.url + "/rest/v1/" + tbl + "?id=not.is.null", {
        method: "DELETE",
        headers: supaHeaders(),
      });
      if (!(r.status >= 200 && r.status < 300)) {
        const t = await r.text().catch(() => "");
        failed.push(tbl + " [" + r.status + (t ? ": " + t.slice(0, 90) : "") + "]");
      }
    } catch {
      failed.push(tbl + " [network error]");
    }
  }
  return { ok: failed.length === 0, failed };
}

export async function hasRealData(): Promise<boolean> {
  if ((await allRec("customers")).length) return true;
  if ((await allRec("invoices")).length) return true;
  const q = await allRec<Doc>("quotations");
  return q.some(
    (d) =>
      (d.customerName && d.customerName.trim()) ||
      (d.sections || []).some((s) => (s.rows || []).some((r) => +r.l || +r.w || +r.t || +r.pcs)),
  );
}

/** Test the saved config by hitting one table. */
export async function testConnection(): Promise<{ status: number; ok: boolean; text: string }> {
  const r = await fetch(supa.url + "/rest/v1/" + tableName("quotations") + "?select=id&limit=1", { headers: supaHeaders() });
  const text = r.ok ? "" : (await r.text().catch(() => "")).replace(/\s+/g, " ").trim();
  return { status: r.status, ok: r.ok, text };
}

export { docStore };
