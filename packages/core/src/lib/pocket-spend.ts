import type { Expense } from "./types";

/** Books category + passbook label for a UPI-pocket lorry pay. */
export const TRANSPORT_LABEL = "Transport";

type TransportRow = Pick<Expense, "pocketSpend" | "charge" | "account" | "holderId">;

/** Locked lorry bill — not paid from a UPI pocket yet (no Books, no pocket drop). */
export function isPendingTransport(e: TransportRow): boolean {
  return e.pocketSpend === "transport" && !e.charge && !(e.account || "").trim() && !(e.holderId || "").trim();
}

/** Paid from an Accounts UPI pocket (not till cash, not an owner Collect). */
export function isAccountTransportPay(e: TransportRow): boolean {
  return e.pocketSpend === "transport" && !e.charge && !isPendingTransport(e);
}

/** Name looks like a lorry UPI (e.g. "CS KUMAR(SVT TRANSPORT CHENNAI)"). */
export function isTransportPocketName(...names: (string | undefined)[]): boolean {
  return names.some((n) => /transport/i.test(n || ""));
}

export function transportPlaceOf(e: Pick<Expense, "placeOfSupply" | "boughtFrom">): string {
  return (e.placeOfSupply || e.boughtFrom || "").trim();
}

/** Still needed on the UPI pocket: locked dues minus what is already sitting there. */
export function transportNeedToCollect(dueTotal: number, pocketBal: number): number {
  const due = Math.round((+dueTotal || 0) * 100) / 100;
  const bal = Math.round((+pocketBal || 0) * 100) / 100;
  return Math.round(Math.max(0, due - bal) * 100) / 100;
}

/** Locked due belongs on this holder/account (unassigned dues fall to transport pockets). */
export function dueOnTransportPocket(
  e: Pick<Expense, "transportPocket">,
  pocket: { id?: string; name?: string },
  pocketIsTransport: boolean,
): boolean {
  const p = (e.transportPocket || "").trim().toLowerCase();
  if (p) return p === (pocket.id || "").trim().toLowerCase() || p === (pocket.name || "").trim().toLowerCase();
  return pocketIsTransport;
}

/** Transporter · vehicle · place — chips, Transport tab, Books detail. */
export function transportDueLabel(
  e: Pick<Expense, "party" | "vehicleNo" | "placeOfSupply" | "boughtFrom">,
): string {
  const bits = [(e.party || "").trim() || "—"];
  const veh = (e.vehicleNo || "").trim();
  if (veh) bits.push(veh);
  const place = transportPlaceOf(e);
  if (place) bits.push(place);
  return bits.join(" · ");
}
