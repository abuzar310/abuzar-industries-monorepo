// Run: npx tsx apps/unofficial/src/excel/lib/preset.check.ts
import { EXCEL_PRESETS, snapshotFromPreset } from "./preset.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(EXCEL_PRESETS.length >= 1, "at least one preset");
const yard = snapshotFromPreset(EXCEL_PRESETS[0].csv, "Yard sheet", "wb-test");
ok(yard.id === "wb-test", "preset keeps id");
ok(yard.name === "Yard sheet", "preset keeps name");
ok(yard.sheetOrder.length === 1, "one sheet");
const header = yard.sheets[yard.sheetOrder[0]]?.cellData[0];
ok(header?.[0]?.v === "Date", "A1 Date");
ok(header?.[6]?.v === "Amount", "G1 Amount");

const rec = snapshotFromPreset(EXCEL_PRESETS[1].csv, "Receipts", "wb-rec");
ok(rec.sheets[rec.sheetOrder[0]]?.cellData[0]?.[1]?.v === "From", "B1 From");

console.log(`excel preset.check OK (${n} assertions)`);
