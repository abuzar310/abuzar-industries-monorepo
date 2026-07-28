// Server-side auth: scrypt-hashed user passwords in the database + a signed,
// httpOnly session cookie. No passwords or tokens ever live in browser storage.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { q, tableRef, type AppSchema } from "./db";

export interface AppUser {
  id: string;
  name: string;
  role: "owner" | "manager";
}

const SESSION_DAYS = 30;
export const SESSION_COOKIE = "app_session";

function secret(): string {
  const s = process.env.APP_SESSION_SECRET;
  if (!s) throw new Error("APP_SESSION_SECRET must be set in environment");
  return s;
}

// ---- password hashing ----

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw.normalize(), salt, 32).toString("hex");
  return `s1:${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [v, salt, hash] = (stored || "").split(":");
  if (v !== "s1" || !salt || !hash) return false;
  const got = scryptSync(pw.normalize(), salt, 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---- session cookie ----

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionToken(user: AppUser): string {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = [user.id, user.name, user.role, exp].join("|");
  const b64 = Buffer.from(payload).toString("base64url");
  return b64 + "." + sign(b64);
}

export function readSessionToken(token: string | undefined): AppUser | null {
  if (!token) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig || sign(b64) !== sig) return null;
  const [id, name, role, exp] = Buffer.from(b64, "base64url").toString().split("|");
  if (!id || !role || Date.now() > +exp) return null;
  if (role !== "owner" && role !== "manager") return null;
  return { id, name: name || id, role };
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86400;
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearSessionCookie = () =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ---- user store ----

interface DbUser extends AppUser {
  password: string;
}

const DEFAULT_USERS: { id: string; name: string; role: "owner" | "manager"; pw: string }[] = [
  { id: "afsar", name: "Owner", role: "owner", pw: "afsar786" },
  { id: "ajju", name: "Manager", role: "manager", pw: "ajju786" },
];

const seeded: Partial<Record<AppSchema, boolean>> = {};

/** Make sure the app's user rows exist (first boot on a fresh database). */
export async function ensureUsers(schema: AppSchema): Promise<void> {
  if (seeded[schema]) return;
  for (const u of DEFAULT_USERS) {
    await q(
      `insert into ${tableRef(schema, "users")} (id, name, role, password)
       values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [u.id, u.name, u.role, hashPassword(u.pw)],
    );
  }
  seeded[schema] = true;
}

export async function listUsers(schema: AppSchema): Promise<AppUser[]> {
  await ensureUsers(schema);
  const rows = await q<DbUser>(
    `select id, name, role from ${tableRef(schema, "users")} order by role`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role }));
}

/** Check a user's password. Returns the user on success. */
export async function checkLogin(
  schema: AppSchema,
  userId: string,
  password: string,
): Promise<AppUser | null> {
  await ensureUsers(schema);
  const rows = await q<DbUser>(
    `select id, name, role, password from ${tableRef(schema, "users")} where id = $1`,
    [userId],
  );
  const u = rows[0];
  if (!u) return null;
  const pw = (password || "").trim();
  if (!verifyPassword(pw, u.password)) return null;
  return { id: u.id, name: u.name, role: u.role };
}

/** Require a minimum role. Throws if the user lacks it. */
export function requireRole(user: AppUser | null, minRole: "manager" | "owner"): AppUser {
  if (!user) throw new Error("Not signed in");
  if (minRole === "owner" && user.role !== "owner") throw new Error("Owner role required");
  if (minRole === "manager" && user.role !== "owner" && user.role !== "manager") throw new Error("Manager role required");
  return user;
}

export async function changeUserPassword(
  schema: AppSchema,
  userId: string,
  newPassword: string,
): Promise<void> {
  await q(`update ${tableRef(schema, "users")} set password = $2 where id = $1`, [
    userId,
    hashPassword(newPassword),
  ]);
}
