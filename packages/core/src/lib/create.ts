// Document creation. The id AND number are allocated ATOMICALLY by the database
// (rpc/create-doc runs inside an advisory lock), so two devices can never mint
// the same quotation number or overwrite each other — the old "went missing" bug
// class is structurally impossible.
import { clone, prefSet, rpcCreateDoc } from "./data";
import { blankDoc } from "./doc";
import { getFeatures } from "./features";
import { defaultWoodSection } from "./woods";
import type { Customer, Doc, Section } from "./types";

/** Official apps: new docs start as Imported Teak Wood (never bare "Teak"). */
function applyOfficialDefaultWood(d: Doc, seed?: Partial<Doc>) {
  if (getFeatures().simpleQuote) return;
  if (seed?.sections?.length) return;
  d.sections = [defaultWoodSection()];
}

/** Create + persist a blank quotation, returning it. Caller navigates to /editor/<id>. */
export async function createQuotation(seed?: Partial<Doc>): Promise<Doc> {
  const d = blankDoc("");
  if (seed) Object.assign(d, seed);
  d.kind = "quotation";
  applyOfficialDefaultWood(d, seed);
  // server assigns id + number ("<fy>-NNN", strictly monotonic over all rows ever)
  const doc = await rpcCreateDoc({ ...d, id: "", number: "" });
  prefSet("lastOpen", { store: "quotations", id: doc.id });
  return doc;
}

/** Create + persist a blank custom invoice (no source quotation), returning it.
 *  id = permanent UID · number = human display (1,2,3… for buys; sales series for sells). */
export async function createInvoice(seed?: Partial<Doc>): Promise<Doc> {
  const d = blankDoc("");
  d.kind = "invoice";
  d.paymentStatus = "Pending";
  d.amountPaid = 0;
  d.tradeType = seed?.tradeType === "buy" ? "buy" : "sell";
  if (seed) Object.assign(d, seed, { kind: "invoice", tradeType: d.tradeType });
  // Payment mode default: Credit (Cash / UPI / Bank Transfer / Credit)
  d.payType = seed?.payType || "Credit";
  // Tax invoice HSN — timber default; seed/convert can override, field stays editable
  d.hsn = String(seed?.hsn || "").trim() || "4407";
  applyOfficialDefaultWood(d, seed);
  // server assigns the UID; a provided seed.number is honoured, else it fills the
  // lowest free display serial for this trade type
  const doc = await rpcCreateDoc({ ...d, id: "", number: seed?.number ? String(seed.number).trim() : "" });
  prefSet("lastOpen", { store: "invoices", id: doc.id });
  return doc;
}

export async function createQuotationForCustomer(c: Customer): Promise<Doc> {
  return createQuotation({
    customerId: c.id,
    customerName: c.name,
    phone: c.phone,
    site: c.site,
    sitePhone: c.sitePhone || "",
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
    sitePhone: c.sitePhone || "",
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
