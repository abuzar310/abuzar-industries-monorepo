// Pure ledger derivations — NO db/cloud imports, so it stays unit-testable in
// plain node (see ledger.check.ts). All balances are computed from raw vouchers.
import type { Account, Customer, LedgerEntry, Vendor, VoucherKind } from "./types";

export const r2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (x: string | number) => String(x).padStart(2, "0");

/** GST split for a sale/purchase: taxable + rate% -> {gstAmount, total}. */
export function gstOf(taxable: number, rate: number) {
  const t = Math.abs(+taxable || 0);
  const gstAmount = r2((t * (+rate || 0)) / 100);
  return { gstAmount, total: r2(t + gstAmount) };
}

export const isGstKind = (k: VoucherKind) => k === "sale" || k === "purchase";

/** Tally Dr/Cr presentation of a party balance.
 *  Debtor +ve = Dr (they owe us); Creditor +ve = Cr (we owe them). */
export function drCr(kind: "debtor" | "creditor", bal: number): { abs: number; side: "Dr" | "Cr" } {
  const side: "Dr" | "Cr" = kind === "debtor" ? (bal >= 0 ? "Dr" : "Cr") : (bal >= 0 ? "Cr" : "Dr");
  return { abs: Math.abs(bal), side };
}

// ---------- party ledger (running balance, natural sense) ----------
//
// Balance is the party's OUTSTANDING in its natural direction:
//   debtor   → positive = receivable (they owe us)
//   creditor → positive = payable    (we owe them)
// opening + (sale|purchase) raise it; (receipt|payment) lower it.

/** Signed effect of a voucher on this party's natural outstanding. */
export function voucherDelta(partyKind: "debtor" | "creditor", e: LedgerEntry): number {
  const a = +e.amount || 0;
  if (partyKind === "debtor") {
    if (e.kind === "opening" || e.kind === "sale") return a;
    if (e.kind === "receipt") return -a;
    return 0;
  }
  if (e.kind === "opening" || e.kind === "purchase") return a;
  if (e.kind === "payment") return -a;
  return 0;
}

export interface PartyRow {
  e: LedgerEntry;
  delta: number;
  running: number;
}
export interface PartyLedger {
  opening: number;
  charges: number; // total sales (debtor) or purchases (creditor)
  settled: number; // total received (debtor) or paid (creditor)
  balance: number; // outstanding
  rows: PartyRow[];
}

export function partyLedger(
  partyKind: "debtor" | "creditor",
  partyId: string,
  entries: LedgerEntry[],
): PartyLedger {
  const mine = entries.filter((e) => e.partyId === partyId).sort(cmpVoucher);
  let opening = 0,
    charges = 0,
    settled = 0,
    running = 0;
  const rows: PartyRow[] = mine.map((e) => {
    const delta = voucherDelta(partyKind, e);
    if (e.kind === "opening") opening = r2(opening + e.amount);
    else if (delta > 0) charges = r2(charges + e.amount);
    else if (delta < 0) settled = r2(settled + e.amount);
    running = r2(running + delta);
    return { e, delta, running };
  });
  return { opening, charges, settled, balance: running, rows };
}

export function partyBalance(
  partyKind: "debtor" | "creditor",
  partyId: string,
  entries: LedgerEntry[],
): number {
  return partyLedger(partyKind, partyId, entries).balance;
}

/** Debtors that have any ledger activity, joined with their balance. */
export function debtorRows(customers: Customer[], entries: LedgerEntry[]) {
  const active = new Set(entries.filter((e) => e.partyKind === "debtor").map((e) => e.partyId));
  return customers
    .filter((c) => active.has(c.id))
    .map((c) => ({ party: c, balance: partyBalance("debtor", c.id, entries) }))
    .sort((a, b) => b.balance - a.balance);
}

/** All creditors joined with their balance. */
export function creditorRows(vendors: Vendor[], entries: LedgerEntry[]) {
  return vendors
    .map((v) => ({ party: v, balance: partyBalance("creditor", v.id, entries) }))
    .sort((a, b) => b.balance - a.balance);
}

// ---------- bank book (per account, running balance) ----------

export interface BankRow {
  e: LedgerEntry;
  delta: number;
  running: number;
}
export interface BankBook {
  opening: number;
  rows: BankRow[];
  closing: number;
}

/** Signed cash movement of a voucher on `accountId`. */
function bankDelta(accountId: string, e: LedgerEntry): number {
  const a = +e.amount || 0;
  if (e.kind === "receipt" && e.account === accountId) return a; // money in
  if (e.kind === "payment" && e.account === accountId) return -a; // money out
  if (e.kind === "contra") {
    if (e.account === accountId) return a; // into destination
    if (e.fromAccount === accountId) return -a; // out of source
  }
  return 0; // sale/purchase/opening: no bank movement
}

export function accountBook(accountId: string, entries: LedgerEntry[], opening = 0): BankBook {
  const touching = entries
    .filter((e) => e.account === accountId || e.fromAccount === accountId)
    .sort(cmpVoucher);
  let running = r2(opening);
  const rows: BankRow[] = touching.map((e) => {
    const delta = bankDelta(accountId, e);
    running = r2(running + delta);
    return { e, delta, running };
  });
  return { opening: r2(opening), rows, closing: running };
}

export function accountBalance(account: Account, entries: LedgerEntry[]): number {
  return accountBook(account.id, entries, account.opening).closing;
}

// ---------- date helpers (dd-mm-yy storage <-> yyyy-mm-dd native input) ----------

/** "dd-mm-yy" -> sortable "yyyymmdd". */
export function dmyToSort(d: string): string {
  const [dd, mm, yy] = (d || "").split("-");
  if (!dd || !mm || !yy) return "00000000";
  return "20" + pad2(yy) + pad2(mm) + pad2(dd);
}

/** "dd-mm-yy" -> "yyyy-mm-dd" for a native date input. */
export function dmyToIso(d: string): string {
  const [dd, mm, yy] = (d || "").split("-");
  if (!dd || !mm || !yy) return "";
  return "20" + pad2(yy) + "-" + pad2(mm) + "-" + pad2(dd);
}

/** "yyyy-mm-dd" -> "dd-mm-yy" (app storage format). */
export function isoToDmy(iso: string): string {
  const [yyyy, mm, dd] = (iso || "").split("-");
  if (!yyyy || !mm || !dd) return "";
  return pad2(dd) + "-" + pad2(mm) + "-" + yyyy.slice(2);
}

export function cmpVoucher(a: LedgerEntry, b: LedgerEntry): number {
  const ka = dmyToSort(a.date),
    kb = dmyToSort(b.date);
  return ka === kb ? (a.createdAt || "").localeCompare(b.createdAt || "") : ka.localeCompare(kb);
}
