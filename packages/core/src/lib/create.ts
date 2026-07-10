import { clone, getRec, metaSet, put } from "./db";
import { blankDoc } from "./doc";
import { nextNumber, fyLabel } from "./numbering";
import { cloudNextQuotationNo } from "./cloud";
import { pad } from "./calc";
import { snapshotBefore } from "./autobackup";
import { mirrorDoc } from "./folderMirror";
import { newInvoiceUid, nextInvoiceDisplayNumber, type InvoiceTrade } from "./invoice-id";
import type { Customer, Doc, Kind, Section } from "./types";

/** Id is free only if no row exists — purged rows stay forever, so their ids are never reused
 *  (reusing would let a sync UPSERT overwrite the archived document). */
function idFree(ex: Doc | undefined): boolean {
  return !ex;
}

/** A quotation id guaranteed not to already name any stored record (live, trashed, or purged). */
async function freeId(store: "quotations" | "invoices", kind: Kind): Promise<string> {
  let id = await nextNumber(kind);
  for (let i = 0; i < 5; i++) {
    const ex = await getRec<Doc>(store, id);
    if (idFree(ex)) break;
    id = await nextNumber(kind);
  }
  return id;
}

/**
 * Permanent invoice primary key (UID). Never equals the printed number — that separation is
 * what stops "delete 3 → next becomes 4 forever" and silent UPSERT overwrites.
 */
export async function freeInvoiceId(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const id = newInvoiceUid();
    if (idFree(await getRec<Doc>("invoices", id))) return id;
  }
  // astronomically unlikely; still guarantee uniqueness
  return newInvoiceUid() + "_" + Date.now().toString(36);
}

/** A collision-proof quotation id ("2026-27-NNN"), allocated atomically from the cloud with
 *  a local fallback when offline — same guarantee as invoices. */
async function freeQuotationId(): Promise<string> {
  const fy = fyLabel();
  const cloudN = await cloudNextQuotationNo(fy);
  if (cloudN == null) return freeId("quotations", "quotation");
  let n = cloudN;
  for (let i = 0; i < 100; i++) {
    const id = fy + "-" + pad(n, 3);
    const ex = await getRec<Doc>("quotations", id);
    if (idFree(ex)) break;
    n++;
  }
  return fy + "-" + pad(n, 3);
}

/** Create + persist a blank quotation, returning it. Caller navigates to /editor/<id>. */
export async function createQuotation(seed?: Partial<Doc>): Promise<Doc> {
  const id = await freeQuotationId();
  const d = blankDoc(id);
  if (seed) Object.assign(d, seed, { id, number: id });
  await put("quotations", clone(d));
  await metaSet("lastOpen", { store: "quotations", id });
  snapshotBefore().catch(() => {}); // capture the new record in a local snapshot (throttled)
  mirrorDoc(clone(d)).catch(() => {}); // write it to the chosen local folder immediately (if connected)
  return d;
}

/** Create + persist a blank custom invoice (no source quotation), returning it.
 *  id = permanent UID · number = human display (1,2,3… for buys; sales series for sells). */
export async function createInvoice(seed?: Partial<Doc>): Promise<Doc> {
  const id = await freeInvoiceId();
  const trade: InvoiceTrade = seed?.tradeType === "buy" ? "buy" : "sell";
  const display =
    seed?.number && String(seed.number).trim()
      ? String(seed.number).trim()
      : await nextInvoiceDisplayNumber(trade);
  const d = blankDoc(id);
  d.kind = "invoice";
  d.paymentStatus = "Pending";
  d.amountPaid = 0;
  d.tradeType = trade;
  d.number = display;
  if (seed) Object.assign(d, seed, { id, number: display, kind: "invoice", tradeType: trade });
  await put("invoices", clone(d));
  await metaSet("lastOpen", { store: "invoices", id });
  snapshotBefore().catch(() => {});
  mirrorDoc(clone(d)).catch(() => {});
  return d;
}

export async function createQuotationForCustomer(c: Customer): Promise<Doc> {
  return createQuotation({
    customerId: c.id,
    customerName: c.name,
    phone: c.phone,
    site: c.site,
    address: c.address,
    custGstin: c.gstin || "",
    notes: c.notes,
  });
}

export async function createInvoiceForCustomer(c: Customer): Promise<Doc> {
  return createInvoice({
    customerId: c.id,
    customerName: c.name,
    phone: c.phone,
    site: c.site,
    address: c.address,
    custGstin: c.gstin || "",
    notes: c.notes,
  });
}

export async function createSampleQuotation(sections: Section[]): Promise<Doc> {
  return createQuotation({
    customerName: "Walk-in Customer",
    site: "Chitradurga",
    sections: clone(sections),
  });
}
