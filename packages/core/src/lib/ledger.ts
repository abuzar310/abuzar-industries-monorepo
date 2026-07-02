// Tally-style double-entry ledger I/O. Raw ledgers + vouchers are stored; every
// balance is DERIVED on read by ledger-calc (re-exported below). Sync is automatic
// via the cloud TABLE map (ledgers, vouchers).
import { allRec, getRec, put, delRec, metaGet, metaSet } from "./db";
import { nowIso, todayStr, uid } from "./calc";
import { trySync, cloudDelete } from "./cloud";
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
  l.synced = false;
  await put("ledgers", l);
  trySync();
  return l;
}

/** Refuse to delete a ledger still used by any voucher. */
export async function deleteLedger(id: string): Promise<{ ok: boolean; count: number }> {
  const vs = await allVouchers();
  const count = vs.filter((v) => v.legs.some((l) => l.ledgerId === id)).length;
  if (count > 0) return { ok: false, count };
  await delRec("ledgers", id);
  cloudDelete("ledgers", id);
  return { ok: true, count: 0 };
}

// ---------- vouchers ----------

export const allVouchers = () => allRec<Voucher>("vouchers");

/** Per-type running number (Tally: "Receipt No. 210"), stored in meta. */
export async function nextVoucherNo(type: VoucherType): Promise<number> {
  const key = "vno_" + type;
  const n = (await metaGet<number>(key, 0)) + 1;
  await metaSet(key, n);
  return n;
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
    synced: false,
  };
  if (!isBalanced(v)) throw new Error("Voucher not balanced (Dr ≠ Cr)");
  await put("vouchers", v);
  trySync();
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
    synced: false,
  };
  if (!isBalanced(v)) throw new Error("Voucher not balanced (Dr ≠ Cr)");
  await put("vouchers", v);
  trySync();
  return v;
}

export async function deleteVoucher(id: string): Promise<void> {
  await delRec("vouchers", id);
  cloudDelete("vouchers", id);
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

/** Seed the chart + a few balanced vouchers on first boot (empty ledgers store). */
export async function seedLedger(enteredBy: string): Promise<void> {
  const have = await allLedgers();
  if (have.length) return;
  const now = nowIso();
  const id = new Map<string, string>();
  const mk = async (name: string, group: LedgerGroup, opening = 0, extra: Partial<Ledger> = {}) => {
    const l: Ledger = {
      id: "L-" + uid(),
      name,
      group,
      opening: r2(opening),
      gstin: extra.gstin || "",
      phone: extra.phone || "",
      address: extra.address || "",
      notes: extra.notes || "",
      createdAt: now,
      updatedAt: now,
      synced: false,
    };
    await put("ledgers", l);
    id.set(name, l.id);
  };

  // Cash / banks (opening kept balanced against Capital so the trial balance is 0)
  await mk("Cash", "Cash-in-hand", 250000);
  await mk("HDFC BANK C/A 9458", "Bank Accounts", 0);
  await mk("STATE BANK OF INDIA A/C 9748", "Bank Accounts", 0);
  await mk("KOTAK BANK SB A/C 5445", "Bank Accounts", 0);
  await mk("AXIS BANK OD", "Bank OD", 0);
  await mk("Sri Mohamed Afsar Capital A/c", "Capital Account", -250000);
  // Tax + trading heads
  await mk(TAX_CGST, "Duties & Taxes", 0);
  await mk(TAX_SGST, "Duties & Taxes", 0);
  await mk(TAX_IGST, "Duties & Taxes", 0);
  await mk("SGST INPUT @ 9%", "Duties & Taxes", 0);
  await mk(SALES_LEDGER, "Sales Accounts", 0);
  await mk("Shop Rent Received @ 18%", "Indirect Incomes", 0);
  await mk(PURCHASE_LEDGER, "Purchase Accounts", 0);
  await mk("BANK CHARGES", "Indirect Expenses", 0);
  // Debtors (customers)
  for (const d of ["ARADHYA PRIVATE LTD", "AFFAN ALI", "IRFANULLA", "SHAMES TABREZ", "M H A TRADERS", "NAZEEMA", "ZAYHAN TIMBERS", "RAHAMATHULLA"]) {
    await mk(d, "Sundry Debtors", 0);
  }
  // Creditors (suppliers)
  await mk("ASAD TRADER", "Sundry Creditors", 0, { address: "Maharashtra - 431122" });
  for (const c of ["MAHI TIMBERS", "VANDANA TIMBER PRIVATE LIMITED", "RSONS TIMBER", "PATEL VENEERS PVT LTD", "SHREE MOOKAMBIKA TIMBER"]) {
    await mk(c, "Sundry Creditors", 0);
  }

  const L = (n: string) => id.get(n)!;
  const tax = { cgst: L(TAX_CGST), sgst: L(TAX_SGST), igst: L(TAX_IGST) };
  const post = async (type: VoucherType, date: string, legs: VLeg[], narration: string) => {
    await addVoucher({ type, date, legs, narration, enteredBy });
  };

  // Local sale to ARADHYA (₹1,41,936.30 incl 18% GST) then part-receipts
  await post("Sales", "03-05-26", salesLegs(L("ARADHYA PRIVATE LTD"), L(SALES_LEDGER), 120285, 18, "split", tax), "Sale @ 18%");
  await post("Receipt", "03-05-26", receiptLegs(L("Cash"), L("ARADHYA PRIVATE LTD"), 8936.3), "Cash received");
  await post("Receipt", "09-05-26", receiptLegs(L("HDFC BANK C/A 9458"), L("ARADHYA PRIVATE LTD"), 43000), "Bank receipt");
  // More local sales
  await post("Sales", "06-05-26", salesLegs(L("M H A TRADERS"), L(SALES_LEDGER), 85000, 18, "split", tax), "Teak logs");
  await post("Sales", "11-05-26", salesLegs(L("NAZEEMA"), L(SALES_LEDGER), 42000, 18, "split", tax), "Sized wood");
  await post("Sales", "18-05-26", salesLegs(L("ZAYHAN TIMBERS"), L(SALES_LEDGER), 168000, 18, "split", tax), "Bulk order");
  await post("Sales", "22-05-26", salesLegs(L("IRFANULLA"), L(SALES_LEDGER), 33000, 18, "split", tax), "Planks");
  // Interstate purchase from ASAD TRADER (₹1,20,169 incl 18% IGST) then payment
  await post("Purchase", "04-05-26", purchaseLegs(L("ASAD TRADER"), L(PURCHASE_LEDGER), 101838.14, 18, "igst", tax), "Interstate purchase");
  await post("Purchase", "14-05-26", purchaseLegs(L("PATEL VENEERS PVT LTD"), L(PURCHASE_LEDGER), 210000, 18, "igst", tax), "Veneer sheets");
  // Payments to creditors
  await post("Payment", "12-05-26", paymentLegs(L("ASAD TRADER"), L("HDFC BANK C/A 9458"), 50000), "Part payment");
  await post("Payment", "20-05-26", paymentLegs(L("PATEL VENEERS PVT LTD"), L("AXIS BANK OD"), 150000), "Against bill");
  // Receipts from debtors
  await post("Receipt", "13-05-26", receiptLegs(L("Cash"), L("M H A TRADERS"), 40000), "Cash received");
  await post("Receipt", "19-05-26", receiptLegs(L("HDFC BANK C/A 9458"), L("ZAYHAN TIMBERS"), 175000), "Bank transfer");
  await post("Receipt", "06-06-26", receiptLegs(L("HDFC BANK C/A 9458"), L("AFFAN ALI"), 10000), "Advance received");
  // Bank transfers (contra) + rent income + a charge
  await post("Contra", "10-05-26", contraLegs(L("HDFC BANK C/A 9458"), L("Cash"), 20000), "Cash deposited to bank");
  await post("Contra", "25-05-26", contraLegs(L("AXIS BANK OD"), L("HDFC BANK C/A 9458"), 100000), "Fund transfer");
  await post("Receipt", "01-06-26", receiptLegs(L("HDFC BANK C/A 9458"), L("RAHAMATHULLA"), 23600), "Shop rent (incl GST)");
  await post("Journal", "30-06-26", journalLegs(L("BANK CHARGES"), L("HDFC BANK C/A 9458"), 826), "Bank charges");

  trySync();
}
