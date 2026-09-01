import type { Expense } from "./types";

/** Books category + passbook label for a UPI-pocket lorry pay. */
export const TRANSPORT_LABEL = "Transport";

/** Paid from an Accounts UPI pocket (not till cash, not an owner Collect). */
export function isAccountTransportPay(e: Pick<Expense, "pocketSpend" | "charge">): boolean {
  return e.pocketSpend === "transport" && !e.charge;
}
