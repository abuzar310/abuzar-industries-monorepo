import { snapshotFromCsv } from "./csv";
import type { UniSnapshot } from "./xlsx-convert";
import { emptyYardSnapshot } from "./yard-format";

export const EXCEL_PRESETS = [
  { id: "yard", label: "Yard sheet", hint: "Teak · White Teak · Neem" },
  { id: "receipts", label: "Receipts", hint: "Date · From · Mode · Amount · Note" },
] as const;

const RECEIPTS_CSV = "Date,From,Mode,Amount,Note";

export function snapshotFromPreset(
  id: string,
  bookId = "wb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
): UniSnapshot {
  if (id === "yard") return emptyYardSnapshot(bookId, "Yard sheet");
  const snap = snapshotFromCsv(RECEIPTS_CSV + "\n");
  snap.id = bookId;
  snap.name = "Receipts";
  return snap;
}
