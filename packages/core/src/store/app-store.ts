// Tiny vanilla external store for app-wide UI state (sync dot, toast, and a
// data-version counter that view components watch to refetch).
// Read with useSyncExternalStore via the useApp() hook. Zero dependencies.
import type { LocalUser, SyncState } from "@/lib/types";

export type BrandMode = "demo" | "real";

export interface AppState {
  ready: boolean;
  syncState: SyncState;
  toast: string;
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
  /** Buys register reminders that are due today or overdue */
  buysDue: number;
  /** unread owner-manager chat messages */
  chatUnseen: number;
  /** unofficial panic cloak (owner/manager): blank money/rates app-wide (cloud meta — syncs all devices) */
  cloakMoney: boolean;
}

let state: AppState = {
  ready: false,
  syncState: "local",
  toast: "",
  dataVersion: 0,
  searchTerm: "",
  user: null,
  brandMode: "demo",
  unseen: 0,
  buysDue: 0,
  chatUnseen: 0,
  cloakMoney: false,
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
export const bumpData = () => set({ dataVersion: state.dataVersion + 1 });
export const setSearch = (searchTerm: string) => set({ searchTerm });
export const setUser = (user: LocalUser | null) => set({ user });
export const setBrandMode = (brandMode: BrandMode) => set({ brandMode });
export const setUnseen = (unseen: number) => set({ unseen });
export const setBuysDue = (buysDue: number) => set({ buysDue });
export const setChatUnseen = (chatUnseen: number) => set({ chatUnseen });
export const setCloakMoney = (cloakMoney: boolean) => set({ cloakMoney });

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: "" }), 2200);
}
