import { clone, getRec, metaSet, put } from "./db";
import { blankDoc } from "./doc";
import { nextNumber, fyLabel } from "./numbering";
import { cloudNextInvoiceNo, cloudNextQuotationNo } from "./cloud";
import { pad } from "./calc";
import { snapshotBefore } from "./autobackup";
import { mirrorDoc } from "./folderMirror";
import type { Customer, Doc, Kind, Section } from "./types";

/** A quotation id guaranteed not to already name a LIVE record. */
async function freeId(store: "quotations" | "invoices", kind: Kind): Promise<string> {
  let id = await nextNumber(kind);
  for (let i = 0; i < 5; i++) {
    const ex = await getRec<Doc>(store, id);
    if (!ex || ex.deletedAt) break;
    id = await nextNumber(kind);
  }
  return id;
}

/**
 * A collision-proof invoice id. Numbers are allocated ATOMICALLY from the cloud so two
 * devices can never receive the same one — the sync UPSERT keys on this id, and a clash
 * used to silently overwrite an existing invoice ("invoice went missing"). Falls back to
 * local monotonic numbering only when offline. As a final guard we still never return an
 * id that already names a LIVE local invoice.
 */
async function freeInvoiceId(): Promise<string> {
  const cloudN = await cloudNextInvoiceNo();
  let n = cloudN != null ? cloudN : parseInt(await nextNumber("invoice"), 10) || 1;
  for (let i = 0; i < 100; i++) {
    const ex = await getRec<Doc>("invoices", String(n));
    if (!ex || ex.deletedAt) break;
    n++;
  }
  return String(n);
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
    if (!ex || ex.deletedAt) break;
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

/** Create + persist a blank custom invoice (no source quotation), returning it. */
export async function createInvoice(seed?: Partial<Doc>): Promise<Doc> {
  const id = await freeInvoiceId();
  const d = blankDoc(id);
  d.kind = "invoice";
  d.paymentStatus = "Pending";
  d.amountPaid = 0;
  if (seed) Object.assign(d, seed, { id, number: id, kind: "invoice" });
  await put("invoices", clone(d));
  await metaSet("lastOpen", { store: "invoices", id });
  snapshotBefore().catch(() => {}); // capture the new invoice in a local snapshot (throttled)
  mirrorDoc(clone(d)).catch(() => {}); // write it to the chosen local folder immediately (if connected)
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
