// Imperative Review QR overlay — shown after a payment is recorded, or via the
// "Review" button. Uses useSyncExternalStore (same pattern as dialogs).
// Auto-triggers open at most once per document (quotation / invoice id) so a
// second amount entry on the same quote does not re-pop the flyer. A different
// quote still gets the flyer on its first payment. Manual Review always opens.
import { useSyncExternalStore } from "react";

const DOCS_KEY = "abuzar:reviewQrShownDocs";

let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function readShownDocs(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DOCS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string" && !!x));
  } catch {
    return new Set();
  }
}

function writeShownDocs(ids: Set<string>) {
  try {
    sessionStorage.setItem(DOCS_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode / blocked storage — ignore */
  }
}

function alreadyShownForDoc(docId: string): boolean {
  return readShownDocs().has(docId);
}

function markShownForDoc(docId: string) {
  const ids = readShownDocs();
  ids.add(docId);
  writeShownDocs(ids);
}

/**
 * @param opts.force — open even if already shown for this doc (toolbar Review)
 * @param opts.docId — quotation/invoice id; required for auto-show (once per doc)
 */
export function showReviewQr(opts?: { force?: boolean; docId?: string }) {
  if (opts?.force) {
    open = true;
    emit();
    return;
  }
  const id = (opts?.docId || "").trim();
  if (!id) return;
  if (alreadyShownForDoc(id)) return;
  markShownForDoc(id);
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
