// Run: npx tsx apps/unofficial/src/excel/lib/persist.check.ts
import { sheetHasCells, shouldWriteSnap } from "./persist.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const filled = { sheets: { a: { cellData: { 0: { 0: { v: 4242 } } } } } };
const blank = { sheets: { a: { cellData: {} } } };
const noSheets = {};

ok(!sheetHasCells(null), "missing snap has no cells");
ok(!sheetHasCells(noSheets), "no sheets has no cells");
ok(!sheetHasCells(blank), "empty cellData has no cells");
ok(sheetHasCells(filled), "A1 4242 counts as cells");
ok(shouldWriteSnap(null, blank), "first save of an empty book is allowed");
ok(shouldWriteSnap(blank, filled), "a filled snap always writes");
ok(!shouldWriteSnap(filled, blank), "blank must not wipe a filled book");
ok(shouldWriteSnap(blank, blank), "empty over empty still writes (new book)");

console.log(`excel persist.check OK (${n} assertions)`);
