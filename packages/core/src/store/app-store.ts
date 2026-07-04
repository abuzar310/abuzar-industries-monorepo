// Tiny vanilla external store for app-wide UI state (sync dot, toast, login gate,
// auth identity, and a data-version counter that view components watch to refetch).
// Read with useSyncExternalStore via the useApp() hook. Zero dependencies.
import type { LocalUser, SyncState } from "@/lib/types";

export type BrandMode = "demo" | "real";

export interface AppState {
  ready: boolean;
  syncState: SyncState;
  toast: string;
  showLogin: boolean;
  /** when true the login gate hides its "continue offline" escape hatch */
  loginStrict: boolean;
  authEmail: string;
  isAdmin: boolean;
  /** bump to tell list/dashboard views their underlying data changed */
  dataVersion: number;
  /** global search box term, shared across list views */
  searchTerm: string;
  /** the signed-in local user (Owner / Manager), or null when the app is locked */
  user: LocalUser | null;
  /** active brand identity: generic demo (default) or real Abuzar */
  brandMode: BrandMode;
  /** count of unseen owner notifications */
  unseen: number;
}

let state: AppState = {
  ready: false,
  syncState: "local",
  toast: "",
  showLogin: false,
  loginStrict: false,
  authEmail: "",
  isAdmin: false,
  dataVersion: 0,
  searchTerm: "",
  user: null,
  brandMode: "demo",
  unseen: 0,
};

const listeners = new Set<() => void>();

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = () => state;

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// ---- actions ----
export const setReady = (ready: boolean) => set({ ready });
export const setSyncState = (syncState: SyncState) => set({ syncState });
export const setShowLogin = (showLogin: boolean, loginStrict = state.loginStrict) =>
  set({ showLogin, loginStrict });
export const setAuthIdentity = (authEmail: string, isAdmin: boolean) => set({ authEmail, isAdmin });
export const bumpData = () => set({ dataVersion: state.dataVersion + 1 });
export const setSearch = (searchTerm: string) => set({ searchTerm });
export const setUser = (user: LocalUser | null) => set({ user });
export const setBrandMode = (brandMode: BrandMode) => set({ brandMode });
export const setUnseen = (unseen: number) => set({ unseen });

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: "" }), 2200);
}
