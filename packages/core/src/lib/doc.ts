import { nowIso, todayStr } from "./calc";
import { clone, getCached } from "./data";
import { defaultWoodSection } from "./woods";
import type { Doc, DocStore } from "./types";

export const docStore = (d: Doc): DocStore =>
  d.kind === "invoice" ? "invoices" : "quotations";

/** Quotations use FY-sequence ids ("2026-27-001"); everything else — a short legacy
 *  invoice id ("2695"), a UID ("inv_…"), or a legacy "INV-2026-27-…" id — is an invoice.
 *  Best-effort hint only; prefer loadDoc() (checks both stores). */
export const isInvoiceId = (id: string): boolean => !/^\d{4}-\d{2}-\d+$/.test(id);

/** Best-guess store for an id (see isInvoiceId). */
export const storeForId = (id: string): DocStore =>
  isInvoiceId(id) ? "invoices" : "quotations";

/** Load a document by id WITHOUT trusting the id format: checks invoices then quotations.
 *  Invoice ids were shortened from "INV-2026-27-2661" to "2661", so a prefix check is no
 *  longer reliable — this always finds the doc in whichever store actually holds it. */
export async function loadDoc(id: string): Promise<Doc | undefined> {
  return clone(getCached<Doc>("invoices", id) || getCached<Doc>("quotations", id));
}

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
    sitePhone: "",
    address: "",
    notes: "",
    date: todayStr(),
    sections: [defaultWoodSection()],
    gst: 18,
    quotationId: "",
    paymentStatus: "Pending",
    amountPaid: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    stockDeducted: false,
  };
}
