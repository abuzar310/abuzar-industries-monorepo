// Capture the install prompt globally so Settings can offer "Install app"
// regardless of when the browser fires beforeinstallprompt.
/* eslint-disable @typescript-eslint/no-explicit-any */
let deferred: any = null;
let started = false;

export function initPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
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
