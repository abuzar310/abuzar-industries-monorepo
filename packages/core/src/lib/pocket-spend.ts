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
