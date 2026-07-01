// Owner notifications: when a new daybook entry made by someone else syncs in,
// the owner's device flags it (unseen badge + browser Notification while online).
import { metaGet, metaSet } from "./db";
import { inr, nowIso } from "./calc";
import { allExpenses, allSessions, typeLabel } from "./expenses";
import { USERS } from "./local-auth";
import { getState, setUnseen } from "@/store/app-store";

let lastSeen = "";
let notified = new Set<string>();

const whoName = (id: string) => USERS.find((u) => u.id === id)?.name || id;

export async function loadNotifyState() {
  lastSeen = await metaGet<string>("lastSeenExpenseAt", "");
}

/** Ask for notification permission. Returns the resulting permission. Must be
 *  called from a user gesture on iOS. */
export async function requestNotifyPermission(): Promise<string> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function fire(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  // Prefer the service-worker registration on installed PWAs (works on iOS home-screen apps).
  try {
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(title, { body, tag }))
      .catch(() => new Notification(title, { body, tag }));
  } catch {
    try {
      new Notification(title, { body, tag });
    } catch {}
  }
}

/** Recount unseen activity from other users and fire notifications for new entries + handovers. */
export async function checkOwnerNotifications() {
  const me = getState().user;
  if (me?.role !== "owner") return;
  const [list, sessions] = await Promise.all([allExpenses(), allSessions()]);
  const fresh = list.filter((e) => e.enteredBy !== me.id && (!lastSeen || (e.createdAt || "") > lastSeen));
  const freshSessions = sessions.filter((s) => s.by !== me.id && (!lastSeen || (s.closedAt || "") > lastSeen));
  setUnseen(fresh.length + freshSessions.length);

  fresh
    .filter((e) => !notified.has(e.id))
    .slice(0, 3)
    .forEach((e) => {
      fire("New daybook entry", `${whoName(e.enteredBy)}: ${typeLabel(e.type)} — ₹${inr(e.amount)}`, e.id);
      notified.add(e.id);
    });
  freshSessions
    .filter((s) => !notified.has(s.id))
    .slice(0, 2)
    .forEach((s) => {
      fire("Cash handed over", `${whoName(s.by)} gave ₹${inr(s.given)} · session closed`, s.id);
      notified.add(s.id);
    });
  fresh.forEach((e) => notified.add(e.id));
  freshSessions.forEach((s) => notified.add(s.id));
}

/** Owner opened the daybook — everything up to now is seen. */
export async function markExpensesSeen() {
  lastSeen = nowIso();
  notified = new Set();
  await metaSet("lastSeenExpenseAt", lastSeen);
  setUnseen(0);
}
