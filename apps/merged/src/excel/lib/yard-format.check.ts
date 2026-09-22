// Run: npx tsx apps/unofficial/src/excel/lib/yard-format.check.ts
import { parseCsv } from "./csv.ts";
import { emptyYardSnapshot, isYardFormat, woodKey, yardFromGrid } from "./yard-format.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(woodKey("White Teak") === "white-teak", "white teak");
ok(woodKey("TEAK") === "teak" && woodKey("Neem wood") === "neem", "teak and neem");

const blank = emptyYardSnapshot("wb-blank", "Yard sheet");
const sheet = blank.sheets[blank.sheetOrder[0]];
ok(sheet.cellData[0][2]?.v === "QUOTATION", "title");
ok(sheet.cellData[2][2]?.v === "TEAK", "teak block");
ok(sheet.cellData[4][5]?.f === "=(B5*C5*D5*E5)/144", "first feet formula");
ok(sheet.cellData[15][3]?.v === 4000, "teak rate 4000");
ok(sheet.cellData[16][2]?.v === "WHITE TEAK", "white teak follows teak");
ok(sheet.cellData[29][3]?.v === 2600, "white teak rate 2600");
ok(sheet.cellData[30][2]?.v === "NEEM", "neem follows white teak");
ok(sheet.cellData[43][3]?.v === 1000, "neem rate 1000");
ok(sheet.mergeData.some((m) => m.startColumn === 2 && m.endColumn === 4), "quotation merge");

const houseGrid = [
  ["", "", "QUOTATION"],
  ["SL No", "L", "W", "T", "Pieces", "Feet"],
  ["1", "8", "5", "3", "2"],
];
ok(!isYardFormat(houseGrid), "headers alone are not enough");
ok(isYardFormat([["QUOTATION"], ["TEAK"], ["SL No", "L", "W", "T", "Pieces", "Feet"]]), "their file is our format");
ok(yardFromGrid([["QUOTATION"], ["TEAK"], ["SL No", "L", "W", "T", "Pieces", "Feet"]]) === null, "do not reconvert our sheet");

const purchase = parseCsv("Length,Breadth,Height,Pcs,Wood\n8,5,3,4,Teak\n9,6,2,2,White Teak\n7,4,2,10,Neem\n");
const converted = yardFromGrid(purchase);
ok(!!converted, "purchase list converts");
const out = converted!.sheets[converted!.sheetOrder[0]].cellData;
ok(out[4][1]?.v === 8 && out[4][2]?.v === 5 && out[4][3]?.v === 3 && out[4][4]?.v === 4, "teak line");
ok(out[18][1]?.v === 9 && out[18][2]?.v === 6 && out[18][4]?.v === 2, "white teak line");
ok(out[32][1]?.v === 7 && out[32][4]?.v === 10, "neem line");

const many = parseCsv(
  "L,W,T,Pcs,Wood\n" + Array.from({ length: 12 }, (_, i) => `${8 + i},5,3,1,Teak`).join("\n"),
);
const grown = yardFromGrid(many)!;
const g = grown.sheets[grown.sheetOrder[0]].cellData;
ok(g[4][1]?.v === 8 && g[15][1]?.v === 19, "12 teak lines grow the block");
ok(g[16][5]?.f === "=SUM(F5:F16)", "feet total covers the extra row");
ok(g[17][2]?.v === "WHITE TEAK", "white teak still follows");

const inches = parseCsv("L,W,T,Pcs,CFT,Wood\n6.3,5,3,1,6.5625,Teak\n");
const asFeet = yardFromGrid(inches)!;
const teakL = asFeet.sheets[asFeet.sheetOrder[0]].cellData[4][1]?.v;
ok(typeof teakL === "number" && Math.abs(teakL - 6.25) < 0.001, "6.3 with matching CFT is 6 ft 3 in");

console.log(`excel yard-format.check OK (${n} assertions)`);
