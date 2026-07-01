import { getRec, put } from "./db";
import { cftOf, nowIso } from "./calc";
import type { Doc, Stock } from "./types";

export const stockKey = (name: string) => (name || "").trim().toLowerCase();

/** Deduct each section's CFT from matching stock (by wood-type name). Once only. */
export async function maybeDeductStock(d: Doc): Promise<boolean> {
  if (d.stockDeducted) return false;
  for (const sec of d.sections) {
    let cft = 0;
    sec.rows.forEach((r) => (cft += cftOf(r)));
    if (cft <= 0) continue;
    const key = stockKey(sec.name);
    if (!key) continue;
    let st = await getRec<Stock>("stock", key);
    if (!st) st = { key, name: sec.name, cft: 0, updatedAt: nowIso(), synced: false };
    st.cft = Math.round(((+st.cft || 0) - cft) * 100) / 100;
    st.updatedAt = nowIso();
    st.synced = false;
    await put("stock", st);
  }
  d.stockDeducted = true;
  return true;
}
