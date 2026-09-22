// Run: npx tsx apps/unofficial/src/excel/lib/preset.check.ts
import { EXCEL_PRESETS, snapshotFromPreset } from "./preset.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(EXCEL_PRESETS.length >= 1, "at least one preset");
ok(EXCEL_PRESETS[0].id === "yard", "yard is first");
const yard = snapshotFromPreset("yard", "wb-test");
ok(yard.id === "wb-test", "preset keeps id");
ok(yard.name === "Yard sheet", "preset keeps name");
ok(yard.sheetOrder.length === 1, "one sheet");
const cells = yard.sheets[yard.sheetOrder[0]]?.cellData;
ok(cells?.[0]?.[2]?.v === "QUOTATION", "yard title");
ok(cells?.[2]?.[2]?.v === "TEAK", "teak heading");
ok(cells?.[16]?.[2]?.v === "WHITE TEAK", "white teak heading");
ok(cells?.[30]?.[2]?.v === "NEEM", "neem heading");

const rec = snapshotFromPreset("receipts", "wb-rec");
ok(rec.sheets[rec.sheetOrder[0]]?.cellData[0]?.[1]?.v === "From", "B1 From");

console.log(`excel preset.check OK (${n} assertions)`);
