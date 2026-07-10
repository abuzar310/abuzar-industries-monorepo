import { allRec, getRec, metaGet, metaSet, put } from "./db";
import { nowIso, uid } from "./calc";
import type { Customer, Doc, Supplier } from "./types";

/** Create or update a supplier contact (purchase-side only — never touches customers). */
export async function saveSupplier(fields: {
  id?: string;
  name: string;
  phone?: string;
  address?: string;
  gstin?: string;
  notes?: string;
}): Promise<Supplier> {
  let s: Supplier | undefined;
  if (fields.id) s = await getRec<Supplier>("suppliers", fields.id);
  if (!s) s = { id: "SUP-" + uid(), createdAt: nowIso(), site: "", opening: 0 } as Supplier;
  s.name = fields.name.trim();
  s.phone = (fields.phone || "").trim();
  s.site = "";
  s.address = (fields.address || "").trim();
  s.gstin = (fields.gstin || "").trim().toUpperCase();
  s.notes = (fields.notes || "").trim();
  s.opening = 0;
  s.updatedAt = nowIso();
  s.synced = false;
  await put("suppliers", s);
  return s;
}

/** Link a purchase doc to a supplier record (creates one if needed). Mutates d.customerId. */
export async function upsertSupplierFromDoc(d: Doc): Promise<Supplier | undefined> {
  const name = (d.customerName || "").trim();
  if (!name) return;
  let s: Supplier | undefined;
  if (d.customerId) s = await getRec<Supplier>("suppliers", d.customerId);
  if (!s) {
    const all = await allRec<Supplier>("suppliers");
    s = all.find(
      (c) => (c.name || "").toLowerCase() === name.toLowerCase() && (c.phone || "") === (d.phone || ""),
    );
  }
  if (!s) s = { id: "SUP-" + uid(), createdAt: nowIso(), site: "", opening: 0 } as Supplier;
  s.name = name;
  s.phone = d.phone || s.phone || "";
  s.address = d.address || s.address || "";
  s.gstin = (d.custGstin || s.gstin || "").trim().toUpperCase();
  s.notes = d.notes || s.notes || "";
  s.updatedAt = nowIso();
  s.synced = false;
  d.customerId = s.id;
  await put("suppliers", s);
  return s;
}

/** One-time: copy parties from existing purchase invoices into the suppliers store
 *  (so Vandana etc. show up under Suppliers without re-typing). Idempotent. */
export async function seedSuppliersFromPurchases(): Promise<number> {
  const done = await metaGet("suppliersSeeded", false);
  if (done) return 0;
  const [invs, custs, existing] = await Promise.all([
    allRec<Doc>("invoices"),
    allRec<Customer>("customers"),
    allRec<Supplier>("suppliers"),
  ]);
  const byName = new Map(existing.map((s) => [(s.name || "").toLowerCase(), s]));
  let n = 0;
  for (const inv of invs) {
    if (inv.tradeType !== "buy") continue;
    const name = (inv.customerName || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    const c =
      (inv.customerId && custs.find((x) => x.id === inv.customerId)) ||
      custs.find((x) => (x.name || "").toLowerCase() === key);
    const s = await saveSupplier({
      name,
      phone: inv.phone || c?.phone || "",
      address: inv.address || c?.address || "",
      gstin: inv.custGstin || c?.gstin || "",
      notes: c?.notes || "",
    });
    byName.set(key, s);
    n++;
  }
  await metaSet("suppliersSeeded", true);
  return n;
}
