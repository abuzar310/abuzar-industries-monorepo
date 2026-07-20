// Owner notifications: when someone else adds a daybook entry, hands over cash, or
// creates a quotation, the owner's device fires a notification (and flags the unseen
// badge). The notification watermark (lastNotifiedAt) is kept SEPARATE from the
// seen/badge watermark (lastSeen) so opening the daybook can never suppress future
// alerts — that was the "fires once then stops" bug.
//
// iOS note: a PWA only runs JS while it's open, so without a push server these fire
// only while the app is in the foreground. True background delivery needs Web Push.
import { allRec, prefGet, prefSet } from "./data";
import { computeDoc, inr, nowIso } from "./calc";
import { allExpenses, allSessions, typeLabel } from "./expenses";
import { getFeatures } from "./features";
import { USERS } from "./local-auth";
import { getState, setUnseen } from "@/store/app-store";
import type { Doc } from "./types";

let lastSeen = ""; // badge: owner opened the daybook
let lastNotifiedAt = ""; // notifications: never re-alert on anything older than this

const whoName = (id: string) => USERS.find((u) => u.id === id)?.name || id;

// Watermarks are DEVICE-LOCAL on purpose: each owner device should badge/alert
// on what *it* hasn't seen yet.
export function loadNotifyState() {
  lastSeen = prefGet<string>("lastSeenExpenseAt", "");
  lastNotifiedAt = prefGet<string>("lastNotifiedAt", "");
  // first ever run: start the notification clock now so we don't alert for all of history
  if (!lastNotifiedAt) {
    lastNotifiedAt = nowIso();
    prefSet("lastNotifiedAt", lastNotifiedAt);
  }
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
  // Prefer the service-worker registration (required on installed iOS home-screen apps).
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

interface Ev {
  at: string;
  title: string;
  body: string;
  tag: string;
}

/** Refresh the unseen badge and fire a notification for each new item by someone else. */
export async function checkOwnerNotifications() {
  const me = getState().user;
  if (me?.role !== "owner") return;
  const [list, sessions] = await Promise.all([allExpenses(), allSessions()]);

  // --- unseen badge (independent of notifications) ---
  const unseenE = list.filter((e) => e.enteredBy !== me.id && (!lastSeen || (e.createdAt || "") > lastSeen)).length;
  const unseenS = sessions.filter((s) => s.by !== me.id && (!lastSeen || (s.closedAt || "") > lastSeen)).length;
  setUnseen(unseenE + unseenS);

  // --- notifications: everything newer than lastNotifiedAt, by someone else ---
  const events: Ev[] = [];
  for (const e of list) {
    if (e.enteredBy !== me.id && (e.createdAt || "") > lastNotifiedAt) {
      events.push({ at: e.createdAt || "", title: "New daybook entry", body: `${whoName(e.enteredBy)}: ${typeLabel(e.type)} — ₹${inr(e.amount)}`, tag: e.id });
    }
  }
  for (const s of sessions) {
    if (s.by !== me.id && (s.closedAt || "") > lastNotifiedAt) {
      events.push({ at: s.closedAt || "", title: "Cash handed over", body: `${whoName(s.by)} gave ₹${inr(s.given)} · session closed`, tag: s.id });
    }
  }
  // quotations — only in multi-user apps (owner watching a manager), not the solo official app
  if (!getFeatures().soloLogin) {
    const quotes = await allRec<Doc>("quotations");
    for (const q of quotes) {
      if ((q.createdAt || "") > lastNotifiedAt && q.status === "Created") {
        events.push({ at: q.createdAt || "", title: "New quotation", body: `${q.number} · ${q.customerName || "—"} · ₹${inr(computeDoc(q).grand)}`, tag: q.id });
      }
    }
  }

  if (!events.length) return;
  events.sort((a, b) => a.at.localeCompare(b.at));
  events.slice(-6).forEach((ev) => fire(ev.title, ev.body, ev.tag)); // cap the burst, never spam
  // advance past EVERY candidate so nothing re-fires, even the ones beyond the cap
  lastNotifiedAt = events.reduce((mx, ev) => (ev.at > mx ? ev.at : mx), lastNotifiedAt);
  prefSet("lastNotifiedAt", lastNotifiedAt);
}

/** Owner opened the daybook — clears the unseen badge only (never touches notifications). */
export async function markExpensesSeen() {
  lastSeen = nowIso();
  prefSet("lastSeenExpenseAt", lastSeen);
  setUnseen(0);
}
