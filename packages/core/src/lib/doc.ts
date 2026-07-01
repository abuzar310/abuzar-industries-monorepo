import { nowIso, todayStr } from "./calc";
import type { Doc, DocStore } from "./types";

export const docStore = (d: Doc): DocStore =>
  d.kind === "invoice" ? "invoices" : "quotations";

/** Which IndexedDB store a document id belongs to, by prefix. */
export const storeForId = (id: string): DocStore =>
  id.startsWith("INV") ? "invoices" : "quotations";

export function blankDoc(id: string): Doc {
  return {
    id,
    kind: "quotation",
    number: id,
    status: "Draft",
    customerId: "",
    customerName: "",
    phone: "",
    site: "",
    address: "",
    notes: "",
    date: todayStr(),
    sections: [{ name: "Teak", rate: 0, rows: [{ l: "", w: "", t: "", pcs: "" }] }],
    gst: 18,
    quotationId: "",
    paymentStatus: "Pending",
    amountPaid: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    synced: false,
    stockDeducted: false,
  };
}
