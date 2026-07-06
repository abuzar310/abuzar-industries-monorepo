import { clone, getRec, metaSet, put } from "./db";
import { blankDoc } from "./doc";
import { nextNumber } from "./numbering";
import type { Customer, Doc, Kind, Section } from "./types";

/** A number guaranteed not to already name a record — hard guard so a "new" doc can NEVER be `put`
 *  over (and overwrite) an existing one, even if numbering ever hands back a taken id. */
async function freeId(store: "quotations" | "invoices", kind: Kind): Promise<string> {
  let id = await nextNumber(kind);
  // A number owned only by a TRASHED doc is reusable (we intentionally reuse deleted invoice
  // numbers — the new doc replaces the binned one). Only keep searching past a LIVE doc.
  for (let i = 0; i < 5; i++) {
    const ex = await getRec<Doc>(store, id);
    if (!ex || ex.deletedAt) break;
    id = await nextNumber(kind);
  }
  return id;
}

/** Create + persist a blank quotation, returning it. Caller navigates to /editor/<id>. */
export async function createQuotation(seed?: Partial<Doc>): Promise<Doc> {
  const id = await freeId("quotations", "quotation");
  const d = blankDoc(id);
  if (seed) Object.assign(d, seed, { id, number: id });
  await put("quotations", clone(d));
  await metaSet("lastOpen", { store: "quotations", id });
  return d;
}

/** Create + persist a blank custom invoice (no source quotation), returning it. */
export async function createInvoice(seed?: Partial<Doc>): Promise<Doc> {
  const id = await freeId("invoices", "invoice");
  const d = blankDoc(id);
  d.kind = "invoice";
  d.paymentStatus = "Pending";
  d.amountPaid = 0;
  if (seed) Object.assign(d, seed, { id, number: id, kind: "invoice" });
  await put("invoices", clone(d));
  await metaSet("lastOpen", { store: "invoices", id });
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
