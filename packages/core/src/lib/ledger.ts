// Tally-style ledger I/O: debtors (reuse Customers), creditors (Vendors), named
// accounts, and vouchers. Raw vouchers are stored; every balance is DERIVED on
// read by the pure functions in ledger-calc (re-exported below). Sync is
// automatic via the cloud TABLE map.
import { allRec, getRec, put, delRec } from "./db";
import { nowIso, todayStr, uid } from "./calc";
import { trySync, cloudDelete } from "./cloud";
import { gstOf, isGstKind, r2 } from "./ledger-calc";
import type { Account, LedgerEntry, Vendor, VoucherKind } from "./types";

export * from "./ledger-calc";

// ---------- vendors (creditor master) ----------

export const allVendors = () => allRec<Vendor>("vendors");

export async function listVendors(): Promise<Vendor[]> {
  const all = await allVendors();
  return all.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function saveVendor(fields: {
  id?: string;
  name: string;
  phone?: string;
  address?: string;
  gstin?: string;
  notes?: string;
}): Promise<Vendor> {
  let v: Vendor | undefined;
  if (fields.id) v = await getRec<Vendor>("vendors", fields.id);
  if (!v) v = { id: "VEN-" + uid(), createdAt: nowIso() } as Vendor;
  v.name = fields.name.trim();
  v.phone = (fields.phone || "").trim();
  v.address = (fields.address || "").trim();
  v.gstin = (fields.gstin || "").trim().toUpperCase();
  v.notes = (fields.notes || "").trim();
  v.updatedAt = nowIso();
  v.synced = false;
  await put("vendors", v);
  trySync();
  return v;
}

/** Refuse to delete a vendor that still has ledger entries. */
export async function deleteVendor(id: string): Promise<{ ok: boolean; count: number }> {
  const entries = await allLedger();
  const count = entries.filter((e) => e.partyId === id).length;
  if (count > 0) return { ok: false, count };
  await delRec("vendors", id);
  cloudDelete("vendors", id);
  return { ok: true, count: 0 };
}

// ---------- accounts (cash / bank) ----------

export const allAccounts = () => allRec<Account>("accounts");

export async function listAccounts(): Promise<Account[]> {
  const all = await allAccounts();
  return all.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

export async function saveAccount(fields: { id?: string; name: string; opening?: number }): Promise<Account> {
  let a: Account | undefined;
  if (fields.id) a = await getRec<Account>("accounts", fields.id);
  if (!a) a = { id: "ACC-" + uid(), createdAt: nowIso() } as Account;
  a.name = fields.name.trim();
  a.opening = r2(+fields.opening! || 0);
  a.updatedAt = nowIso();
  a.synced = false;
  await put("accounts", a);
  trySync();
  return a;
}

/** Seed Cash + UPI on first boot (called from AppProvider, like seedStock). */
export async function seedAccounts(): Promise<void> {
  const have = await allAccounts();
  if (have.length) return;
  const now = nowIso();
  for (const name of ["Cash", "UPI"]) {
    await put("accounts", { id: "ACC-" + uid(), name, opening: 0, createdAt: now, updatedAt: now, synced: false });
  }
  trySync();
}

// ---------- vouchers ----------

export const allLedger = () => allRec<LedgerEntry>("ledger");

export interface VoucherInput {
  kind: VoucherKind;
  date?: string;
  partyKind?: "debtor" | "creditor" | "";
  partyId?: string;
  amount?: number; // taxable for sale/purchase; full amount otherwise
  gstRate?: number;
  account?: string;
  fromAccount?: string;
  ref?: string;
  note?: string;
  enteredBy?: string;
}

function shape(input: VoucherInput, base: Partial<LedgerEntry>): LedgerEntry {
  const contra = input.kind === "contra";
  let taxable: number, gstRate: number, amount: number;
  if (isGstKind(input.kind)) {
    taxable = Math.abs(+input.amount! || 0);
    gstRate = +input.gstRate! || 0;
    amount = gstOf(taxable, gstRate).total;
  } else {
    amount = r2(Math.abs(+input.amount! || 0));
    taxable = amount;
    gstRate = 0;
  }
  return {
    id: base.id || "VCH-" + uid(),
    date: input.date || base.date || todayStr(),
    kind: input.kind,
    partyKind: contra ? "" : input.partyKind || "",
    partyId: contra ? "" : input.partyId || "",
    amount,
    taxable,
    gstRate,
    account: input.account || "",
    fromAccount: contra ? input.fromAccount || "" : "",
    ref: (input.ref || "").trim(),
    note: (input.note || "").trim(),
    enteredBy: input.enteredBy || base.enteredBy || "unknown",
    createdAt: base.createdAt || nowIso(),
    updatedAt: nowIso(),
    synced: false,
  };
}

export async function addEntry(input: VoucherInput): Promise<LedgerEntry> {
  const e = shape(input, {});
  await put("ledger", e);
  trySync();
  return e;
}

export async function editEntry(id: string, input: VoucherInput): Promise<LedgerEntry | null> {
  const old = await getRec<LedgerEntry>("ledger", id);
  if (!old) return null;
  const e = shape(input, { id: old.id, createdAt: old.createdAt, enteredBy: old.enteredBy, date: old.date });
  await put("ledger", e);
  trySync();
  return e;
}

export async function deleteEntry(id: string): Promise<void> {
  await delRec("ledger", id);
  cloudDelete("ledger", id);
}
