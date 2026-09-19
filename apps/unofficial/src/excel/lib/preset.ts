import { snapshotFromCsv } from "./csv";
import type { UniSnapshot } from "./xlsx-convert";

export const EXCEL_PRESETS = [
  { id: "yard", label: "Yard sheet", csv: "Date,Name,Particulars,Qty,CFT,Rate,Amount" },
  { id: "receipts", label: "Receipts", csv: "Date,From,Mode,Amount,Note" },
] as const;

export function snapshotFromPreset(
  csv: string,
  name: string,
  id = "wb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
): UniSnapshot {
  const snap = snapshotFromCsv(csv.endsWith("\n") ? csv : csv + "\n");
  snap.id = id;
  snap.name = name;
  return snap;
}
