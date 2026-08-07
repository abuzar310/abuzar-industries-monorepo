// Imperative Review QR overlay — shown after a payment is recorded, or via the
// "Review" button. Uses useSyncExternalStore (same pattern as dialogs).
// Auto-triggers (payment / receipt) open at most once per browser tab session so
// entering multiple amounts does not keep popping the flyer. Manual Review always opens.
import { useSyncExternalStore } from "react";

const SESSION_KEY = "abuzar:reviewQrShown";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function alreadyShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markShownThisSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* private mode / blocked storage — ignore */
  }
}

/** @param opts.force — open even if already shown this session (toolbar Review button) */
export function showReviewQr(opts?: { force?: boolean }) {
  if (!opts?.force && alreadyShownThisSession()) return;
  open = true;
  markShownThisSession();
  emit();
}

export function hideReviewQr() {
  open = false;
  emit();
}

export function isReviewQrOpen() {
  return open;
}

export function useReviewQrOpen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => open,
    () => false,
  );
}
