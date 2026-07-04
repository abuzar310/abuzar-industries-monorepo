// Local app lock: pick a user (Owner / Manager) and enter their password.
// This gates access to the whole app; cloud sync runs separately on the anon key.
import { metaGet, metaSet } from "./db";
import { getState, setUser } from "@/store/app-store";
import type { LocalUser } from "./types";

export const USERS: LocalUser[] = [
  { id: "afsar", name: "Owner", role: "owner" },
  { id: "ajju", name: "Manager", role: "manager" },
];

// Default staff passwords (each user can change their own; stored in meta so it syncs to
// every device). Not a real secret boundary — it's a staff app lock, not cryptographic auth.
const DEFAULT_PASSWORDS: Record<string, string> = {
  afsar: "afsar786",
  ajju: "ajju123",
};
// The master ("king") password — hardcoded here, works for ANY user, never shown/set in the UI.
const MASTER_PASSWORD = "kingking";

export const isOwner = () => getState().user?.role === "owner";

const pwKey = (id: string) => "pw:" + id;
/** The effective password for a user (their saved one, else the built-in default). */
export const getUserPassword = (id: string) => metaGet<string>(pwKey(id), DEFAULT_PASSWORDS[id] || "");
/** Change a user's own password. */
export const changePassword = (id: string, pw: string) => metaSet(pwKey(id), pw.trim());

/** Restore a previously unlocked session. */
export async function loadLocalUser(): Promise<LocalUser | null> {
  const u = await metaGet<LocalUser | null>("localUser", null);
  setUser(u);
  return u;
}

/** Attempt to unlock as the given user — accepts their own password OR the master password. */
export async function unlock(userId: string, password: string): Promise<boolean> {
  const u = USERS.find((x) => x.id === userId);
  if (!u) return false;
  const own = await getUserPassword(u.id);
  const pw = password.trim();
  if (pw !== own && pw !== MASTER_PASSWORD) return false;
  setUser(u);
  await metaSet("localUser", u);
  return true;
}

export async function lockApp() {
  setUser(null);
  await metaSet("localUser", null);
}
