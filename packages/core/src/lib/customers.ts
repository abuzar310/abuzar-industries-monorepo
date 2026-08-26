import { allRec, getRec, put } from "./data";
import { computeDoc, nowIso, uid } from "./calc";
import { quoteBill, quoteReceived } from "./payments";
import type { Customer, Doc, Expense } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CustomerFinancials {
  quoteCount: number;
  invoiceCount: number;
  quotedTotal: number;
  invoicedTotal: number;
  paid: number;
  /** old dues carried in before the app (from the customer record). */
  opening: number;
  /** total that counts toward dues: opening + (invoices, or quotes-as-bills) + standalone charges. */
  billed: number;
  outstanding: number;
}

/** Roll up a customer's business across their quotations and invoices.
 *  `opening` = old dues carried in before the app; it adds to what they still owe.
 *
 *  Two dues models — kept in step with `partyLedger` (the Balances tab):
 *  - Invoice apps (official): invoices are the dues; quotations are only estimates.
 *  - Quote apps (unofficial, `quotesAsBills`): a **Created** quotation IS the sale, so it
 *    counts toward outstanding, less its recorded payments (amountPaid + standalone receipts),
 *    plus any standalone charges. This is why the Customers tab now matches Balances. */
export function customerFinancials(
  custId: string,
  quotes: Doc[],
  invoices: Doc[],
  opening = 0,
  expenses: Expense[] = [],
  quotesAsBills = false,
): CustomerFinancials {
  const q = quotes.filter((d) => d.customerId === custId && !d.deletedAt && !d.purgedAt);
  const inv = invoices.filter((d) => d.customerId === custId && !d.deletedAt && !d.purgedAt);
  let quotedTotal = 0;
  q.forEach((d) => (quotedTotal += quoteBill(d)));
  let invoicedTotal = 0;
  let invPaid = 0;
  inv.forEach((d) => {
    invoicedTotal += computeDoc(d).grand;
    invPaid += +d.amountPaid || 0;
  });
  const op = r2(+opening || 0);

  // standalone Receipts-tab entries booked straight to a customer (no source quote):
  // a charge adds to dues, a receipt reduces them.
  let charges = 0;
  let receipts = 0;
  for (const e of expenses) {
    if (e.type !== "sale" || e.custId !== custId || e.sourceId) continue;
    if (e.charge) charges += +e.amount || 0;
    else receipts += +e.amount || 0;
  }

  const base = {
    quoteCount: q.length,
    invoiceCount: inv.length,
    quotedTotal: r2(quotedTotal),
    invoicedTotal: r2(invoicedTotal),
    opening: op,
  };

  if (quotesAsBills) {
    // a quote is a bill once it's Created — or once any money is recorded against it (an advance on
    // a still-Draft quote). Same rule as partyLedger, so Customers/Balances/Statements all reconcile.
    const paidSrc = new Set(expenses.filter((e) => e.sourceId).map((e) => e.sourceId as string));
    let billedQ = 0;
    let paidQ = 0;
    q.filter(
      (d) =>
        d.status === "Created" ||
        paidSrc.has(d.id) ||
        (+(d.payCash || 0)) > 0 ||
        (+(d.payUpi || 0)) > 0 ||
        (+(d.payCommission || 0)) > 0 ||
        (+(d.amountPaid || 0)) > 0,
    ).forEach((d) => {
      billedQ += quoteBill(d);
      paidQ += quoteReceived(d, expenses);
    });
    const billed = r2(op + billedQ + charges);
    const paid = r2(paidQ + receipts);
    return { ...base, paid, billed, outstanding: r2(billed - paid) };
  }

  const billed = r2(op + invoicedTotal + charges);
  const paid = r2(invPaid + receipts);
  return { ...base, paid, billed, outstanding: r2(billed - paid) };
}

/** Create or update a customer from a plain field map (used by the add/edit form). */
export async function saveCustomer(fields: {
  id?: string;
  name: string;
  phone?: string;
  site?: string;
  sitePhone?: string;
  siteVillage?: string;
  siteCity?: string;
  address?: string;
  pincode?: string;
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
  cust.sitePhone = (fields.sitePhone || "").trim();
  cust.siteVillage = (fields.siteVillage || "").trim();
  cust.siteCity = (fields.siteCity || "").trim();
  cust.address = (fields.address || "").trim();
  cust.pincode = (fields.pincode || "").trim().replace(/\D/g, "").slice(0, 6);
  cust.gstin = (fields.gstin || "").trim().toUpperCase();
  cust.opening = Math.round((+(fields.opening || 0) || 0) * 100) / 100;
  cust.notes = (fields.notes || "").trim();
  cust.updatedAt = nowIso();
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
  cust.sitePhone = d.sitePhone || cust.sitePhone || "";
  cust.address = d.address || cust.address || "";
  if (d.custPincode) cust.pincode = d.custPincode;
  if (d.custGstin) cust.gstin = d.custGstin;
  cust.notes = d.notes || cust.notes || "";
  cust.updatedAt = nowIso();
  d.customerId = cust.id;
  await put("customers", cust);
  return cust;
}
