"use client";
import { useEffect, useRef } from "react";
import type { AppFeatures, StoreName, Tab } from "@/lib/types";
import { setFeatures } from "@/lib/features";
import { allRec, delRec, getRec, metaGet, openDB, put, setDbSuffix } from "@/lib/db";
import { nowIso } from "@/lib/calc";
import {
  authRequired,
  bgPull,
  bindCloud,
  dayKey,
  ensureAuth,
  gateStrict,
  getSupa,
  isLoggedIn,
  loadSupa,
  loadTombstones,
  mirrorFromCloud,
  authLoad,
  sessionMode,
  setCloudPrefix,
  signOut,
  trySync,
} from "@/lib/cloud";
import { maybeAutoSnapshot } from "@/lib/autobackup";
import { folderNeedsGrant, grantAll, initFolderMirror } from "@/lib/folderMirror";
import {
  bumpData,
  setReady,
  setShowLogin,
  setSyncState,
  toast as toastMsg,
  type BrandMode,
} from "./app-store";
import { refreshAuthIdentity } from "./session";
import { startRealtime, stopRealtime } from "@/lib/realtime";
import { initPwa } from "@/lib/pwa";
import { loadBrand } from "@/lib/brand";
import { loadLocalUser } from "@/lib/local-auth";
import { checkOwnerNotifications, loadNotifyState } from "@/lib/notify";
import TopNav from "@/components/TopNav";
import Toast from "@/components/Toast";
import LoginGate from "@/components/LoginGate";
import LockGate from "@/components/LockGate";
import DialogHost from "@/components/DialogHost";

async function seedStock() {
  const s = await allRec("stock");
  if (!s.length) {
    await put("stock", { key: "teak", name: "Teak", cft: 0, updatedAt: nowIso(), synced: false });
    await put("stock", { key: "neem", name: "Neem", cft: 0, updatedAt: nowIso(), synced: false });
  }
}

export default function AppProvider({
  children,
  tabs,
  features,
  defaultBrand = "demo",
  cloudPrefix = "",
}: {
  children: React.ReactNode;
  tabs: Tab[];
  features?: AppFeatures;
  defaultBrand?: BrandMode;
  cloudPrefix?: string;
}) {
  // Set per-app config before anything opens the DB or syncs (idempotent, static per app).
  if (features) setFeatures(features);
  setCloudPrefix(cloudPrefix); // separate Supabase tables per app
  setDbSuffix(cloudPrefix); // separate local IndexedDB per app
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    initPwa();
    bindCloud({
      sync: setSyncState,
      needLogin: () => setShowLogin(true, gateStrict() && navigator.onLine),
      dataChanged: bumpData,
    });

    let timer: ReturnType<typeof setInterval> | undefined;
    // Realtime: on any cloud change, pull + refresh + notify instantly (debounced).
    // DELETEs aren't captured by the upsert-only pull, so apply them directly.
    let rtTimer: ReturnType<typeof setTimeout> | undefined;
    const onRealtime = (store: string, eventType: string, oldId?: string) => {
      if (eventType === "DELETE" && oldId) {
        // DURABILITY: never honour a remote hard-delete for quotations/invoices. Older clients
        // (or a manual SQL wipe) used to broadcast DELETE and every device would wipe the row.
        // We keep a local purge marker instead so the document is still recoverable, and a later
        // sync can push it back to the cloud.
        if (store === "invoices" || store === "quotations") {
          getRec<{ synced?: boolean; purgedAt?: string; deletedAt?: string; updatedAt?: string }>(
            store as StoreName,
            oldId,
          )
            .then(async (local) => {
              if (!local || local.purgedAt) return;
              const next = {
                ...local,
                deletedAt: local.deletedAt || new Date().toISOString(),
                purgedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                synced: false, // re-push so the cloud row comes back
              };
              await put(store as StoreName, next);
              bumpData();
            })
            .catch(() => {});
          return;
        }
        // Other stores (expenses, etc.): only drop a record we hold as already-synced.
        getRec<{ synced?: boolean }>(store as StoreName, oldId)
          .then((local) => {
            if (local && local.synced) return delRec(store as StoreName, oldId).then(() => bumpData());
          })
          .catch(() => {});
        return;
      }
      clearTimeout(rtTimer);
      rtTimer = setTimeout(async () => {
        await bgPull();
        await checkOwnerNotifications();
      }, 200);
    };
    const onVisible = () => {
      const supa = getSupa();
      if (!document.hidden && supa.url && supa.key && navigator.onLine) {
        trySync().then(() => mirrorFromCloud()); // re-converge to the cloud on return
      }
    };
    const onOnline = () => trySync().then(() => mirrorFromCloud());
    const onOffline = () => setSyncState("off");

    (async function boot() {
      await openDB();
      await seedStock();
      // Ledger data (official) lives in the cloud (ab_ledgers/ab_vouchers) and pulls in via sync — no local seed.
      await loadBrand(defaultBrand);
      await loadLocalUser();
      await loadNotifyState();
      await loadSupa();
      await loadTombstones();
      await authLoad();
      refreshAuthIdentity();
      const supa = getSupa();
      setSyncState(supa.url ? "queue" : "local");

      // session policy: should this open require a fresh sign-in?
      if (supa.url && supa.key && navigator.onLine && isLoggedIn()) {
        const mode = sessionMode();
        let expire = false;
        if (mode === "always") expire = true;
        else if (mode === "daily") {
          const last = await metaGet("lastLoginDay", "");
          expire = last !== dayKey();
        }
        if (expire) {
          await signOut();
          refreshAuthIdentity();
        }
      }

      if (gateStrict() && supa.url && supa.key && !isLoggedIn()) {
        setShowLogin(true, gateStrict() && navigator.onLine);
      } else {
        if (isLoggedIn()) await ensureAuth();
        await trySync(); // push any pending local writes up first…
        await mirrorFromCloud(); // …then make this device match the cloud (single source of truth)
      }

      setReady(true);
      maybeAutoSnapshot(); // rolling local safety-net backup (fire-and-forget)
      // Restore the auto-save folder from a previous session. Browsers drop folder write-permission
      // between sessions (even installed PWAs, inconsistently), so if it needs re-granting we re-grant
      // it automatically on the user's FIRST click/keypress — no button to hunt for.
      initFolderMirror().then(() => {
        if (typeof document === "undefined" || !folderNeedsGrant()) return;
        const reGrant = () => {
          grantAll()
            .then((n) => {
              if (n > 0) bumpData();
              if (!folderNeedsGrant()) {
                document.removeEventListener("pointerdown", reGrant);
                document.removeEventListener("keydown", reGrant);
              }
            })
            .catch(() => {});
        };
        document.addEventListener("pointerdown", reGrant);
        document.addEventListener("keydown", reGrant);
      });
      await checkOwnerNotifications();

      // instant updates via realtime; the interval is just a safety-net fallback
      if (supa.url && supa.key) startRealtime(supa.url, supa.key, cloudPrefix, onRealtime);
      timer = setInterval(async () => {
        const s = getSupa();
        if (!s.url || !s.key || !navigator.onLine) return;
        if (authRequired() && !isLoggedIn()) return;
        await trySync();
        await mirrorFromCloud(); // keep every device an exact mirror of the cloud (all features)
        await checkOwnerNotifications();
      }, 15000);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
    })().catch((e) => {
      console.error(e);
      toastMsg("Startup error — see console");
    });

    return () => {
      if (timer) clearInterval(timer);
      clearTimeout(rtTimer);
      stopRealtime();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // boot runs once; defaultBrand is a static per-app constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <TopNav tabs={tabs} />
      <div className="wrap">{children}</div>
      <Toast />
      <LoginGate />
      <LockGate />
      <DialogHost />
    </>
  );
}
