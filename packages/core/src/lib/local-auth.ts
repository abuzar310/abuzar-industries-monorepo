// Local app lock: pick a user (Afsar / Ajju) and enter their password.
// This gates access to the whole app; cloud sync runs separately on the anon key.
import { metaGet, metaSet } from "./db";
import { getState, setUser } from "@/store/app-store";
import type { LocalUser } from "./types";

export const USERS: LocalUser[] = [
  { id: "afsar", name: "Afsar", role: "owner" },
  { id: "ajju", name: "Ajju", role: "manager" },
];

// Per-user staff passwords (hardcoded). Not a real secret boundary — it's a staff
// app lock, not cryptographic auth.
const PASSWORDS: Record<string, string> = {
  afsar: "afsar786",
  ajju: "ajju123",
};

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
  if (!u || password !== PASSWORDS[u.id]) return false;
  setUser(u);
  await metaSet("localUser", u);
  return true;
}

export async function lockApp() {
  setUser(null);
  await metaSet("localUser", null);
}
