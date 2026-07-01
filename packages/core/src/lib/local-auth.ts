// Local app lock: pick a user (Afsar / Ajju) and enter the shared password.
// This gates access to the whole app; cloud sync runs separately on the anon key.
import { metaGet, metaSet } from "./db";
import { getState, setUser } from "@/store/app-store";
import type { LocalUser } from "./types";

export const USERS: LocalUser[] = [
  { id: "afsar", name: "Afsar", role: "owner" },
  { id: "ajju", name: "Ajju", role: "manager" },
];

// Shared password for now (env-overridable). Not a real secret boundary — it's a
// staff app lock, not cryptographic auth.
const PASSWORD = process.env.NEXT_PUBLIC_APP_PASSWORD ?? "kingking";

export const isOwner = () => getState().user?.role === "owner";

/** Restore a previously unlocked session. */
export async function loadLocalUser(): Promise<LocalUser | null> {
  const u = await metaGet<LocalUser | null>("localUser", null);
  setUser(u);
  return u;
}

/** Attempt to unlock as the given user. Returns true on success. */
export async function unlock(userId: string, password: string): Promise<boolean> {
  const u = USERS.find((x) => x.id === userId);
  if (!u || password !== PASSWORD) return false;
  setUser(u);
  await metaSet("localUser", u);
  return true;
}

export async function lockApp() {
  setUser(null);
  await metaSet("localUser", null);
}
