// Optional auto-posting: mirror an invoice into the Tally ledger as double-entry
// vouchers. Off by default (a Settings toggle). Deterministic voucher ids keyed to
// the invoice id make re-posting idempotent; deleting the invoice unposts them.
import { allRec, getRec, put, delRec, metaGet, metaSet } from "./db";
import { computeDoc, nowIso, uid } from "./calc";
import { trySync, cloudDelete } from "./cloud";
import { getFeatures } from "./features";
import { nextVoucherNo, PURCHASE_LEDGER, SALES_LEDGER, TAX_CGST, TAX_IGST, TAX_SGST } from "./ledger";
import type { Doc, Ledger, LedgerGroup, VLeg, Voucher, VoucherType } from "./types";

const FLAG = "autoPostLedger";
const r2 = (n: number) => Math.round(n * 100) / 100;

export const autoPostEnabled = () => metaGet<boolean>(FLAG, false);
export const setAutoPost = (b: boolean) => metaSet(FLAG, b);

async function findByName(name: string): Promise<Ledger | undefined> {
  const all = await allRec<Ledger>("ledgers");
  const n = name.trim().toLowerCase();
  return all.find((l) => (l.name || "").trim().toLowerCase() === n);
}
async function ensureLedger(name: string, group: LedgerGroup): Promise<string> {
  const found = await findByName(name);
  if (found) return found.id;
  const l: Ledger = {
    id: "L-" + uid(), name: name.trim(), group, opening: 0,
    gstin: "", phone: "", address: "", notes: "",
    createdAt: nowIso(), updatedAt: nowIso(), synced: false,
  };
  await put("ledgers", l);
  return l.id;
}
async function firstOfGroup(group: LedgerGroup, fallbackName: string): Promise<string> {
  const all = await allRec<Ledger>("ledgers");
  const hit = all.find((l) => l.group === group);
  return hit ? hit.id : ensureLedger(fallbackName, group);
}

/** Write (or refresh) a voucher with a fixed id, preserving its number across re-posts. */
async function upsertVoucher(id: string, type: VoucherType, doc: Doc, legs: VLeg[]) {
  const existing = await getRec<Voucher>("vouchers", id);
  const v: Voucher = {
    id,
    no: existing?.no ?? (await nextVoucherNo(type)),
    date: doc.date || nowIso().slice(0, 10),
    type,
    legs,
    narration: (doc.tradeType === "buy" ? "Purchase Inv " : "Tax Inv ") + doc.number,
    enteredBy: "auto",
    sourceId: doc.id,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
    synced: false,
  };
  await put("vouchers", v);
}
async function removeVoucher(id: string) {
  if (await getRec<Voucher>("vouchers", id)) {
    await delRec("vouchers", id);
    cloudDelete("vouchers", id);
  }
}

const tradeVid = (docId: string) => "AV-INV-" + docId;
const settleVid = (docId: string) => "AV-PAY-" + docId;

/** Post/refresh the ledger vouchers for an invoice. No-op unless the toggle is on. */
export async function postInvoice(doc: Doc): Promise<void> {
  if (doc.kind !== "invoice" || !getFeatures().ledger) return;
  if (!(await autoPostEnabled())) return;

  const { sub: taxable, gstAmt: gst, grand } = computeDoc(doc);
  if (grand <= 0) return void (await unpostInvoice(doc.id)); // empty invoice → nothing to post
  const isBuy = doc.tradeType === "buy";
  const igst = doc.gstKind === "igst";

  const partyName = (doc.customerName || "").trim() || (isBuy ? "Cash Purchase" : "Cash Sale");
  const partyId = await ensureLedger(partyName, isBuy ? "Sundry Creditors" : "Sundry Debtors");
  const headName = isBuy ? PURCHASE_LEDGER : SALES_LEDGER;
  const headId = (await findByName(headName))?.id
    || (await firstOfGroup(isBuy ? "Purchase Accounts" : "Sales Accounts", isBuy ? "Purchases" : "Sales @ 18%"));
  const cgstId = (await findByName(TAX_CGST))?.id;
  const sgstId = (await findByName(TAX_SGST))?.id;
  const igstId = (await findByName(TAX_IGST))?.id;
  const cgst = igst ? 0 : r2(gst / 2);
  const sgst = igst ? 0 : r2(gst - cgst);

  // trade voucher legs (balanced: Σdr === Σcr === grand)
  const legs: VLeg[] = [];
  if (isBuy) {
    legs.push({ ledgerId: headId, dr: taxable, cr: 0 });
    if (igst && igstId && gst) legs.push({ ledgerId: igstId, dr: gst, cr: 0 });
    if (!igst && cgstId && cgst) legs.push({ ledgerId: cgstId, dr: cgst, cr: 0 });
    if (!igst && sgstId && sgst) legs.push({ ledgerId: sgstId, dr: sgst, cr: 0 });
    legs.push({ ledgerId: partyId, dr: 0, cr: grand });
  } else {
    legs.push({ ledgerId: partyId, dr: grand, cr: 0 });
    legs.push({ ledgerId: headId, dr: 0, cr: taxable });
    if (igst && igstId && gst) legs.push({ ledgerId: igstId, dr: 0, cr: gst });
    if (!igst && cgstId && cgst) legs.push({ ledgerId: cgstId, dr: 0, cr: cgst });
    if (!igst && sgstId && sgst) legs.push({ ledgerId: sgstId, dr: 0, cr: sgst });
  }
  await upsertVoucher(tradeVid(doc.id), isBuy ? "Purchase" : "Sales", doc, legs);

  // settlement voucher for the amount paid so far
  const paid = r2(Math.max(0, +doc.amountPaid || 0));
  if (paid > 0) {
    const acctId = doc.payType === "UPI"
      ? await firstOfGroup("Bank Accounts", "Bank")
      : await ensureLedger("Cash", "Cash-in-hand");
    const sLegs: VLeg[] = isBuy
      ? [{ ledgerId: partyId, dr: paid, cr: 0 }, { ledgerId: acctId, dr: 0, cr: paid }]
      : [{ ledgerId: acctId, dr: paid, cr: 0 }, { ledgerId: partyId, dr: 0, cr: paid }];
    await upsertVoucher(settleVid(doc.id), isBuy ? "Payment" : "Receipt", doc, sLegs);
  } else {
    await removeVoucher(settleVid(doc.id));
  }
  trySync();
}

/** Remove any vouchers this invoice auto-posted (on delete / clear payments). */
export async function unpostInvoice(docId: string): Promise<void> {
  await removeVoucher(tradeVid(docId));
  await removeVoucher(settleVid(docId));
}
