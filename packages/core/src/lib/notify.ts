// Owner notifications: when a new daybook entry made by someone else syncs in,
// the owner's device flags it (unseen badge + browser Notification while online).
import { metaGet, metaSet } from "./db";
import { inr, nowIso } from "./calc";
import { allExpenses, typeLabel } from "./expenses";
import { USERS } from "./local-auth";
import { getState, setUnseen } from "@/store/app-store";

let lastSeen = "";
let notified = new Set<string>();

export async function loadNotifyState() {
  lastSeen = await metaGet<string>("lastSeenExpenseAt", "");
}

export function requestNotifyPermission() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/** Recount unseen entries (from other users) and fire browser notifications for new ones. */
export async function checkOwnerNotifications() {
  const me = getState().user;
  if (me?.role !== "owner") return;
  const list = await allExpenses();
  const fresh = list.filter((e) => e.enteredBy !== me.id && (!lastSeen || (e.createdAt || "") > lastSeen));
  setUnseen(fresh.length);

  const newly = fresh.filter((e) => !notified.has(e.id));
  if (newly.length && typeof Notification !== "undefined" && Notification.permission === "granted") {
    for (const e of newly.slice(0, 3)) {
      const who = USERS.find((u) => u.id === e.enteredBy)?.name || e.enteredBy;
      try {
        new Notification("New daybook entry", { body: `${who}: ${typeLabel(e.type)} — ₹${inr(e.amount)}`, tag: e.id });
      } catch {}
    }
  }
  newly.forEach((e) => notified.add(e.id));
}

/** Owner opened the daybook — everything up to now is seen. */
export async function markExpensesSeen() {
  lastSeen = nowIso();
  notified = new Set();
  await metaSet("lastSeenExpenseAt", lastSeen);
  setUnseen(0);
}
