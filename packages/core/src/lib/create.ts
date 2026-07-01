import { clone, metaSet, put } from "./db";
import { blankDoc } from "./doc";
import { nextNumber } from "./numbering";
import type { Customer, Doc, Section } from "./types";

/** Create + persist a blank quotation, returning it. Caller navigates to /editor/<id>. */
export async function createQuotation(seed?: Partial<Doc>): Promise<Doc> {
  const id = await nextNumber("quotation");
  const d = blankDoc(id);
  if (seed) Object.assign(d, seed, { id, number: id });
  await put("quotations", clone(d));
  await metaSet("lastOpen", { store: "quotations", id });
  return d;
}

/** Create + persist a blank custom invoice (no source quotation), returning it. */
export async function createInvoice(seed?: Partial<Doc>): Promise<Doc> {
  const id = await nextNumber("invoice");
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

export async function createSampleQuotation(sections: Section[]): Promise<Doc> {
  return createQuotation({
    customerName: "Walk-in Customer",
    site: "Chitradurga",
    sections: clone(sections),
  });
}
