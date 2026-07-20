"use client";
import { useEffect, useRef } from "react";
import type { AppFeatures, Tab } from "@/lib/types";
import { setFeatures } from "@/lib/features";
import { bindUnloadGuard, bootData, pullChanges, resetData } from "@/lib/data";
import { setBrandMode, setReady, setSyncState, setUser, toast as toastMsg, type BrandMode } from "./app-store";
import { setDefaultBrand } from "./session";
import { initPwa } from "@/lib/pwa";
import { loadBrand } from "@/lib/brand";
import { loadLocalUser } from "@/lib/local-auth";
import { checkOwnerNotifications, loadNotifyState } from "@/lib/notify";
import TopNav from "@/components/TopNav";
import Toast from "@/components/Toast";
import LockGate from "@/components/LockGate";
import DialogHost from "@/components/DialogHost";

export default function AppProvider({
  children,
  tabs,
  features,
  defaultBrand = "demo",
}: {
  children: React.ReactNode;
  tabs: Tab[];
  features?: AppFeatures;
  defaultBrand?: BrandMode;
}) {
  // Per-app config, set before anything renders (idempotent, static per app).
  if (features) setFeatures(features);
  setDefaultBrand(defaultBrand);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    initPwa();
    bindUnloadGuard(); // warn before closing a tab with unsent writes
    setBrandMode(defaultBrand); // lock screen shows the right brand pre-login; loadBrand refines after

    // Delta-poll: fold other devices' changes into the cache. On a 401 the
    // session expired — drop everything so the LockGate reappears.
    const poll = async () => {
      if (document.hidden) return;
      try {
        await pullChanges();
        await checkOwnerNotifications();
      } catch {
        setUser(null);
        resetData();
        setReady(true);
      }
    };

    let timer: ReturnType<typeof setInterval> | undefined;
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    const onOnline = () => void poll();
    const onOffline = () => setSyncState("off");

    (async function boot() {
      const user = await loadLocalUser(); // httpOnly session cookie, if still valid
      if (user) {
        await bootData();
        await loadBrand(defaultBrand);
        loadNotifyState();
        await checkOwnerNotifications();
      }
      // No session → LockGate shows; unlock() + afterUnlock() run the same load.
      setReady(true);

      timer = setInterval(() => void poll(), 8000);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
    })().catch((e) => {
      console.error(e);
      setReady(true);
      toastMsg("Startup error — check the connection and reload");
    });

    return () => {
      if (timer) clearInterval(timer);
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
      <LockGate />
      <DialogHost />
    </>
  );
}
