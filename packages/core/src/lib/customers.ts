import { allRec, getRec, put } from "./db";
import { computeDoc, nowIso, uid } from "./calc";
import type { Customer, Doc } from "./types";

export interface CustomerFinancials {
  quoteCount: number;
  invoiceCount: number;
  quotedTotal: number;
  invoicedTotal: number;
  paid: number;
  outstanding: number;
}

/** Roll up a customer's business across their quotations and invoices. */
export function customerFinancials(custId: string, quotes: Doc[], invoices: Doc[]): CustomerFinancials {
  const q = quotes.filter((d) => d.customerId === custId);
  const inv = invoices.filter((d) => d.customerId === custId);
  let quotedTotal = 0;
  q.forEach((d) => (quotedTotal += computeDoc(d).grand));
  let invoicedTotal = 0;
  let paid = 0;
  inv.forEach((d) => {
    invoicedTotal += computeDoc(d).grand;
    paid += +d.amountPaid || 0;
  });
  return {
    quoteCount: q.length,
    invoiceCount: inv.length,
    quotedTotal: Math.round(quotedTotal * 100) / 100,
    invoicedTotal: Math.round(invoicedTotal * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    outstanding: Math.round((invoicedTotal - paid) * 100) / 100,
  };
}

/** Create or update a customer from a plain field map (used by the add/edit form). */
export async function saveCustomer(fields: {
  id?: string;
  name: string;
  phone?: string;
  site?: string;
  address?: string;
  gstin?: string;
  opening?: string | number;
  notes?: string;
}): Promise<Customer> {
  let cust: Customer | undefined;
  if (fields.id) cust = await getRec<Customer>("customers", fields.id);
  if (!cust) cust = { id: "CUST-" + uid(), createdAt: nowIso() } as Customer;
  cust.name = fields.name.trim();
  cust.phone = (fields.phone || "").trim();
  cust.site = (fields.site || "").trim();
  cust.address = (fields.address || "").trim();
  cust.gstin = (fields.gstin || "").trim().toUpperCase();
  cust.opening = Math.round((+(fields.opening || 0) || 0) * 100) / 100;
  cust.notes = (fields.notes || "").trim();
  cust.updatedAt = nowIso();
  cust.synced = false;
  await put("customers", cust);
  return cust;
}

/** Create or update the customer record implied by the open document.
 *  Mutates d.customerId to point at the resolved customer. */
export async function upsertCustomerFromDoc(d: Doc): Promise<Customer | undefined> {
  const name = (d.customerName || "").trim();
  if (!name) return;
  let cust: Customer | undefined;
  if (d.customerId) cust = await getRec<Customer>("customers", d.customerId);
  if (!cust) {
    const all = await allRec<Customer>("customers");
    cust = all.find(
      (c) => (c.name || "").toLowerCase() === name.toLowerCase() && (c.phone || "") === (d.phone || ""),
    );
  }
  if (!cust) cust = { id: "CUST-" + uid(), createdAt: nowIso() } as Customer;
  cust.name = name;
  cust.phone = d.phone || cust.phone || "";
  cust.site = d.site || cust.site || "";
  cust.address = d.address || cust.address || "";
  cust.notes = d.notes || cust.notes || "";
  cust.updatedAt = nowIso();
  cust.synced = false;
  d.customerId = cust.id;
  await put("customers", cust);
  return cust;
}
