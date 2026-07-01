// Capture the install prompt globally so Settings can offer "Install app"
// regardless of when the browser fires beforeinstallprompt.
/* eslint-disable @typescript-eslint/no-explicit-any */
let deferred: any = null;
let started = false;

/** iOS Safari can only show notifications from an installed (home-screen) PWA. */
export const isIOS = () => typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);

export function initPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Register the service worker — required for notifications (installed iOS PWAs especially).
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
  });
}

export const canInstall = () => !!deferred;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  deferred.prompt();
  try {
    await deferred.userChoice;
  } catch {}
  deferred = null;
  return true;
}
