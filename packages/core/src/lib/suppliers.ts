import { allRec, getRec, listCached, metaGet, metaSet, put } from "./data";
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
  // keep from-accounts list (Buys agents) across edits
  if (!s.fromAccounts) s.fromAccounts = [];
  s.updatedAt = nowIso();
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
  d.customerId = s.id;
  await put("suppliers", s);
  return s;
}

// One seed at a time: two views mounting together (or React re-running effects) used
// to both see suppliersSeeded=false and seed concurrently → every supplier duplicated.
let seeding: Promise<number> | null = null;

/** One-time: copy parties from existing purchase invoices into the suppliers store
 *  (so Vandana etc. show up under Suppliers without re-typing). Idempotent + race-safe. */
export function seedSuppliersFromPurchases(): Promise<number> {
  if (!seeding) {
    seeding = doSeed().catch((e) => {
      seeding = null; // a failed run may retry later
      throw e;
    });
  }
  return seeding;
}

async function doSeed(): Promise<number> {
  const done = await metaGet("suppliersSeeded", false);
  if (done) return 0;
  await metaSet("suppliersSeeded", true); // claim FIRST so a parallel boot can't seed too
  const [invs, custs] = await Promise.all([allRec<Doc>("invoices"), allRec<Customer>("customers")]);
  let n = 0;
  for (const inv of invs) {
    if (inv.tradeType !== "buy") continue;
    const name = (inv.customerName || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    // check against the LIVE cache each iteration — never trust a stale snapshot
    if (listCached<Supplier>("suppliers").some((s) => (s.name || "").toLowerCase() === key)) continue;
    const c =
      (inv.customerId && custs.find((x) => x.id === inv.customerId)) ||
      custs.find((x) => (x.name || "").toLowerCase() === key);
    await saveSupplier({
      name,
      phone: inv.phone || c?.phone || "",
      address: inv.address || c?.address || "",
      gstin: inv.custGstin || c?.gstin || "",
      notes: c?.notes || "",
    });
    n++;
  }
  return n;
}
