/**
 * Staff roles for both official + unofficial apps (shared @abuzar/core).
 * Capabilities live on the class hierarchy so Owner and Manager stay in sync —
 * extend CloakCapableStaff (not StaffRole) when a role should get the panic hide UI.
 */

export type AppRole = "owner" | "manager";

/** Base staff — no panic-cloak by default. */
export abstract class StaffRole {
  abstract readonly role: AppRole;
  abstract readonly label: string;

  /** 5× brand tap / Alt+click money cloak (Cut Size / unofficial). */
  canToggleCloak(): boolean {
    return false;
  }
}

/**
 * Shared hide-interface capability.
 * OwnerStaff and ManagerStaff both extend this so they share one implementation.
 */
export abstract class CloakCapableStaff extends StaffRole {
  override canToggleCloak(): boolean {
    return true;
  }
}

export class OwnerStaff extends CloakCapableStaff {
  readonly role = "owner" as const;
  readonly label = "Owner";
}

/** Same core cloak access as Owner — via CloakCapableStaff. */
export class ManagerStaff extends CloakCapableStaff {
  readonly role = "manager" as const;
  readonly label = "Manager";
}

export function staffRoleFor(
  role: AppRole | string | null | undefined,
): StaffRole | null {
  if (role === "owner") return new OwnerStaff();
  if (role === "manager") return new ManagerStaff();
  return null;
}

/** True when this login may toggle the panic money cloak. */
export function canToggleCloak(
  role: AppRole | string | null | undefined,
): boolean {
  return !!staffRoleFor(role)?.canToggleCloak();
}
