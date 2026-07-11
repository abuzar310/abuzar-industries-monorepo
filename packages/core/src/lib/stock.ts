import { getRec, put } from "./data";
import { nowIso, sectionVolumeCft } from "./calc";
import type { Doc, Stock } from "./types";

export const stockKey = (name: string) => (name || "").trim().toLowerCase();

/** Deduct each section's CFT from matching stock (by wood-type name). Once only.
 *  CBM sections are converted to CFT first (1 CBM = 35.315 CFT). */
export async function maybeDeductStock(d: Doc): Promise<boolean> {
  if (d.stockDeducted) return false;
  for (const sec of d.sections || []) {
    const cft = sectionVolumeCft(sec);
    if (cft <= 0) continue;
    const key = stockKey(sec.name);
    if (!key) continue;
    let st = await getRec<Stock>("stock", key);
    if (!st) st = { key, name: sec.name, cft: 0, updatedAt: nowIso() };
    st.cft = Math.round(((+st.cft || 0) - cft) * 100) / 100;
    st.updatedAt = nowIso();
    await put("stock", st);
  }
  d.stockDeducted = true;
  return true;
}
