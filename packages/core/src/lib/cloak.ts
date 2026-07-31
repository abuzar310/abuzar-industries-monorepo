// Unofficial owner-only panic cloak: mask money/rates everywhere.
// Flag lives in cloud meta so phone ↔ PC converge via /changes polling.
// Business records are never deleted — toggle off restores every figure.
import { metaGetCached, metaSet, prefGet, prefSet } from "./data";
import { getFeatures } from "./features";
import { bumpData, getState, setCloakMoney } from "@/store/app-store";

const META = "cloakMoney";
/** legacy device-local key — migrated once into meta */
const LEGACY_PREF = "cloakMoney";

/** True when Cut Size (simpleQuote) is running. */
export function cloakAvailable(): boolean {
  return !!getFeatures().simpleQuote;
}

export function isCloaked(): boolean {
  return cloakAvailable() && !!getState().cloakMoney;
}

/**
 * While cloaked, return no rows so every screen shows its normal empty state.
 * Cloud data is untouched — toggle off and lists refill from cache.
 */
export function cloakList<T>(items: readonly T[] | T[] | null | undefined): T[] {
  if (isCloaked()) return [];
  return items ? [...items] : [];
}

/** Sync app-store + body class from cloud meta (and one-time legacy pref migrate). */
export function hydrateCloak(): void {
  if (typeof document === "undefined") return;
  if (!cloakAvailable()) {
    setCloakMoney(false);
    applyCloakDom(false);
    return;
  }
  let on = !!metaGetCached<boolean>(META, false);
  // one-time: old local-only flag → cloud so other devices pick it up
  try {
    const legacy = prefGet<boolean | null>(LEGACY_PREF, null);
    if (legacy != null) {
      if (legacy && !on) {
        on = true;
        void metaSet(META, true);
      }
      prefSet(LEGACY_PREF, null);
    }
  } catch {
    /* ignore */
  }
  const cur = !!getState().cloakMoney;
  if (cur !== on) {
    setCloakMoney(on);
    bumpData();
  } else {
    setCloakMoney(on);
  }
  applyCloakDom(on);
}

function applyCloakDom(on: boolean): void {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("cloak-money", on);
}

/** Owner-only silent toggle (writes cloud meta). Returns new state, or null if ignored. */
export async function toggleCloak(): Promise<boolean | null> {
  const user = getState().user;
  if (!cloakAvailable() || user?.role !== "owner") return null;
  const next = !getState().cloakMoney;
  await metaSet(META, next);
  setCloakMoney(next);
  applyCloakDom(next);
  bumpData();
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
  } catch {
    /* ignore */
  }
  return next;
}
