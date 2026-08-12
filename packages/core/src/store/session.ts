"use client";
// Side effects shared by the lock gate and the boot path.
import { bootData, isBooted } from "@/lib/data";
import { hydrateCloak } from "@/lib/cloak";
import { loadBrand } from "@/lib/brand";
import { checkOwnerNotifications, loadNotifyState, requestNotifyPermission } from "@/lib/notify";
import { refreshChatUnseen } from "@/lib/staff-chat";
import { bumpData, getState, toast, type BrandMode } from "./app-store";

// The app's default brand (set once by AppProvider from the layout prop).
let defaultBrand: BrandMode = "demo";
export const setDefaultBrand = (m: BrandMode) => {
  defaultBrand = m;
};
export const getDefaultBrand = () => defaultBrand;

/** After a user unlocks the app: load the full dataset from the server. */
export async function afterUnlock() {
  const u = getState().user;
  if (!isBooted()) {
    try {
      await bootData();
      await loadBrand(defaultBrand);
    } catch {
      toast("Could not load data — check the connection and reload");
      return;
    }
  }
  loadNotifyState();
  hydrateCloak(); // re-apply device-local money cloak after unlock
  if (u?.role === "owner") {
    requestNotifyPermission();
    checkOwnerNotifications();
  }
  refreshChatUnseen();
  toast(`Welcome, ${u?.name ?? ""}`);
  bumpData();
}
