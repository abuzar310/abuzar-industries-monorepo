// App lock backed by the server auth API: pick a user (Owner / Manager), enter
// their password, get an httpOnly session cookie. Passwords are scrypt-hashed in
// the database; nothing auth-related ever lives in browser storage.
import { apiChangePassword, apiLogin, apiLogout, apiMe, resetData } from "./data";
import { getState, setUser } from "@/store/app-store";
import type { LocalUser } from "./types";

export const USERS: LocalUser[] = [
  { id: "afsar", name: "Owner", role: "owner" },
  { id: "ajju", name: "Manager", role: "manager" },
];

export const isOwner = () => getState().user?.role === "owner";
export const isManager = () => getState().user?.role === "manager";
/** Owner or manager — same CloakCapableStaff hide access (see staff-role.ts). */
export { canToggleCloak } from "./staff-role";

/** Change the signed-in user's own password (server-side, hashed). */
export const changePassword = (_id: string, pw: string) => apiChangePassword(pw.trim());

/** Restore a previously unlocked session (the httpOnly cookie, if still valid). */
export async function loadLocalUser(): Promise<LocalUser | null> {
  const u = await apiMe();
  setUser(u);
  return u;
}

/** Attempt to unlock as the given user — their own password OR the master password. */
export async function unlock(userId: string, password: string): Promise<boolean> {
  const u = await apiLogin(userId, password.trim());
  if (!u) return false;
  setUser(u);
  return true;
}

export async function lockApp() {
  await apiLogout();
  setUser(null);
  resetData(); // next user starts from a clean fetch
}
