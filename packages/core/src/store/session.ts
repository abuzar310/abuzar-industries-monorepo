"use client";
// Shared sign-in side effects used by both the login gate and Settings.
import { metaSet } from "@/lib/db";
import {
  dayKey,
  getAuth,
  hasRealData,
  pullFromCloud,
  signIn,
  trySync,
} from "@/lib/cloud";
import { BAKED } from "@/lib/constants";
import { checkOwnerNotifications, requestNotifyPermission } from "@/lib/notify";
import { bumpData, getState, setAuthIdentity, setShowLogin, toast } from "./app-store";

/** Side effects after a local user unlocks the app (Owner / Manager). */
export async function afterUnlock() {
  const u = getState().user;
  if (u?.role === "owner") {
    requestNotifyPermission();
    checkOwnerNotifications();
  }
  if (!(await hasRealData())) {
    const n = await pullFromCloud(true);
    if (n) {
      bumpData();
      toast(`Welcome ${u?.name ?? ""} — loaded ${n} records`);
      trySync();
      return;
    }
  }
  toast(`Welcome, ${u?.name ?? ""}`);
  trySync();
  bumpData();
}

export function refreshAuthIdentity() {
  const email = getAuth().email || "";
  setAuthIdentity(email, !!email && BAKED.adminEmails.includes(email.toLowerCase()));
}

export async function afterAuthSuccess() {
  await metaSet("lastLoginDay", dayKey());
  refreshAuthIdentity();
  setShowLogin(false);
  if (!(await hasRealData())) {
    const n = await pullFromCloud(true);
    if (n) {
      bumpData();
      toast("Signed in — restored " + n + " records");
      return;
    }
  }
  toast("Signed in");
  trySync(true);
}

/** Returns "" on success, or an error message. */
export async function doLogin(email: string, password: string): Promise<string> {
  const r = await signIn(email, password);
  if (r.ok) {
    await afterAuthSuccess();
    return "";
  }
  return r.msg || "Sign in failed";
}
