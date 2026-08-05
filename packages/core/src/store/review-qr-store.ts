// Imperative Review QR overlay — shown after a payment is recorded, or via the
// quotation "Review" button. Uses useSyncExternalStore (same pattern as dialogs).
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function showReviewQr() {
  open = true;
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
