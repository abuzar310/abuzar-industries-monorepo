// Tally-style double-entry ledger I/O. Raw ledgers + vouchers are stored; every
// balance is DERIVED on read by ledger-calc (re-exported below).
import { allRec, getRec, put, delRec, rpcNextVoucherNo } from "./data";
import { nowIso, todayStr, uid } from "./calc";
import { gstSplit, isBalanced, r2 } from "./ledger-calc";
import type { Ledger, LedgerGroup, VLeg, Voucher, VoucherType } from "./types";

export * from "./ledger-calc";

// ---------- ledgers (accounts) ----------

export const allLedgers = () => allRec<Ledger>("ledgers");

export async function listLedgers(): Promise<Ledger[]> {
  return (await allLedgers()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function saveLedger(fields: {
  id?: string;
  name: string;
  group: LedgerGroup;
  opening?: number;
  gstin?: string;
  phone?: string;
  address?: string;
  notes?: string;
}): Promise<Ledger> {
  let l: Ledger | undefined;
  if (fields.id) l = await getRec<Ledger>("ledgers", fields.id);
  if (!l) l = { id: "L-" + uid(), createdAt: nowIso() } as Ledger;
  l.name = fields.name.trim();
  l.group = fields.group;
  l.opening = r2(+fields.opening! || 0);
  l.gstin = (fields.gstin || "").trim().toUpperCase();
  l.phone = (fields.phone || "").trim();
  l.address = (fields.address || "").trim();
  l.notes = (fields.notes || "").trim();
  l.updatedAt = nowIso();
  await put("ledgers", l);
  return l;
}

/** Refuse to delete a ledger still used by any voucher. */
export async function deleteLedger(id: string): Promise<{ ok: boolean; count: number }> {
  const vs = await allVouchers();
  const count = vs.filter((v) => v.legs.some((l) => l.ledgerId === id)).length;
  if (count > 0) return { ok: false, count };
  await delRec("ledgers", id);
  return { ok: true, count: 0 };
}

// ---------- vouchers ----------

export const allVouchers = () => allRec<Voucher>("vouchers");

/** Per-type running number (Tally: "Receipt No. 210") — an atomic counter in the database. */
export async function nextVoucherNo(type: VoucherType): Promise<number> {
  return rpcNextVoucherNo(type);
}

export interface VoucherInput {
  type: VoucherType;
  date?: string;
  legs: VLeg[];
  narration?: string;
  enteredBy?: string;
}

export async function addVoucher(input: VoucherInput): Promise<Voucher> {
  const legs = cleanLegs(input.legs);
  const v: Voucher = {
    id: "V-" + uid(),
    no: await nextVoucherNo(input.type),
    date: input.date || todayStr(),
    type: input.type,
    legs,
    narration: (input.narration || "").trim(),
    enteredBy: input.enteredBy || "unknown",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (!isBalanced(v)) throw new Error("Voucher not balanced (Dr ≠ Cr)");
  await put("vouchers", v);
  return v;
}

export async function editVoucher(id: string, input: VoucherInput): Promise<Voucher | null> {
  const old = await getRec<Voucher>("vouchers", id);
  if (!old) return null;
  const v: Voucher = {
    ...old,
    type: input.type,
    date: input.date || old.date,
    legs: cleanLegs(input.legs),
    narration: (input.narration ?? old.narration).trim(),
    updatedAt: nowIso(),
  };
  if (!isBalanced(v)) throw new Error("Voucher not balanced (Dr ≠ Cr)");
  await put("vouchers", v);
  return v;
}

export async function deleteVoucher(id: string): Promise<void> {
  await delRec("vouchers", id);
}

const cleanLegs = (legs: VLeg[]): VLeg[] =>
  legs
    .filter((l) => l.ledgerId && (r2(+l.dr || 0) > 0 || r2(+l.cr || 0) > 0))
    .map((l) => ({ ledgerId: l.ledgerId, dr: r2(+l.dr || 0), cr: r2(+l.cr || 0) }));

// ---------- leg builders for the common voucher types ----------
// Each returns balanced legs ready for addVoucher.

export const receiptLegs = (accountId: string, partyId: string, amt: number): VLeg[] => [
  { ledgerId: accountId, dr: r2(amt), cr: 0 },
  { ledgerId: partyId, dr: 0, cr: r2(amt) },
];
export const paymentLegs = (partyId: string, accountId: string, amt: number): VLeg[] => [
  { ledgerId: partyId, dr: r2(amt), cr: 0 },
  { ledgerId: accountId, dr: 0, cr: r2(amt) },
];
export const contraLegs = (toId: string, fromId: string, amt: number): VLeg[] => [
  { ledgerId: toId, dr: r2(amt), cr: 0 },
  { ledgerId: fromId, dr: 0, cr: r2(amt) },
];
export const journalLegs = (drId: string, crId: string, amt: number): VLeg[] => [
  { ledgerId: drId, dr: r2(amt), cr: 0 },
  { ledgerId: crId, dr: 0, cr: r2(amt) },
];

/** Sales: Dr party (total) · Cr sales (taxable) · Cr output GST. */
export function salesLegs(
  partyId: string,
  salesId: string,
  taxable: number,
  rate: number,
  kind: "split" | "igst" | "none",
  tax: { cgst?: string; sgst?: string; igst?: string },
): VLeg[] {
  const g = gstSplit(taxable, rate, kind);
  const legs: VLeg[] = [
    { ledgerId: partyId, dr: g.total, cr: 0 },
    { ledgerId: salesId, dr: 0, cr: g.taxable },
  ];
  if (g.cgst && tax.cgst) legs.push({ ledgerId: tax.cgst, dr: 0, cr: g.cgst });
  if (g.sgst && tax.sgst) legs.push({ ledgerId: tax.sgst, dr: 0, cr: g.sgst });
  if (g.igst && tax.igst) legs.push({ ledgerId: tax.igst, dr: 0, cr: g.igst });
  return legs;
}

/** Purchase: Dr purchase (taxable) · Dr input GST · Cr party (total). */
export function purchaseLegs(
  partyId: string,
  purchaseId: string,
  taxable: number,
  rate: number,
  kind: "split" | "igst" | "none",
  tax: { cgst?: string; sgst?: string; igst?: string },
): VLeg[] {
  const g = gstSplit(taxable, rate, kind);
  const legs: VLeg[] = [{ ledgerId: purchaseId, dr: g.taxable, cr: 0 }];
  if (g.cgst && tax.cgst) legs.push({ ledgerId: tax.cgst, dr: g.cgst, cr: 0 });
  if (g.sgst && tax.sgst) legs.push({ ledgerId: tax.sgst, dr: g.sgst, cr: 0 });
  if (g.igst && tax.igst) legs.push({ ledgerId: tax.igst, dr: g.igst, cr: 0 });
  legs.push({ ledgerId: partyId, dr: 0, cr: g.total });
  return legs;
}

// ---------- seed: a real-looking sample from their Tally books ----------

/** Names of the well-known posting ledgers, so entry forms can find them. */
export const SALES_LEDGER = "SALES @ 18%";
export const PURCHASE_LEDGER = "INTERSTATE PURCHASE @ 18%";
export const TAX_CGST = "CGST";
export const TAX_SGST = "SGST";
export const TAX_IGST = "IGST";

