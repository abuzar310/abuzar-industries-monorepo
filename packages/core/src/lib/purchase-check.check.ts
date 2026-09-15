// Run: npx tsx packages/core/src/lib/purchase-check.check.ts
import {
  buildCheck,
  guessNotation,
  lengthFeet,
  parsePurchaseRead,
  purchaseNum,
  tallySheet,
  type PurchaseRead,
} from "./purchase-check.ts";
import { purchaseFromGrid, readPurchaseSheetBytes, readSheetBytes } from "./sheet-import.ts";
import { colName, crc32, xlsxBytes } from "./xlsx-write.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};
const near = (a: number, b: number, d = 0.001) => Math.abs(a - b) <= d;

// numbers and lengths as suppliers print them
ok(purchaseNum("1,234.5") === 1234.5 && purchaseNum("1-5") === 1.5 && purchaseNum("") === null && purchaseNum("abc") === null, "numbers as printed");
ok(lengthFeet("6.3", true) === 6.25 && lengthFeet("6.9", true) === 6.75 && lengthFeet("7", true) === 7, "feet.inches");
ok(near(lengthFeet("6.10", true), 6 + 10 / 12) && lengthFeet("6.3", false) === 6.3, "6.10 is ten inches; decimal feet stay as they are");

// container list MSDU2592526: lengths down the side are feet.inches, and its own CFT proves it
const container: PurchaseRead = {
  title: "MSDU2592526",
  totals: { pcs: 114, cft: 83.993, cbm: null },
  lines: [
    { item: "", l: "6", w: "5", t: "3", pcs: "5", cft: "3.125" },
    { item: "", l: "6.3", w: "5", t: "3", pcs: "18", cft: "11.719" },
    { item: "", l: "6.6", w: "5", t: "3", pcs: "47", cft: "31.823" },
    { item: "", l: "6", w: "5", t: "4", pcs: "25", cft: "20.833" },
    { item: "", l: "6.3", w: "5", t: "4", pcs: "19", cft: "16.493" },
  ],
};
const containerNote = guessNotation(container);
ok(containerNote.ftIn && containerNote.why === "cft", "the supplier's CFT proves 6.3 means 6 ft 3 in");
const boxed = buildCheck(container);
ok(boxed.ftIn && boxed.pcs.ok === true && boxed.cft.ok === true && near(boxed.cft.ours, 83.993, 0.01), "our totals match the supplier's");
ok(boxed.groups.length === 1 && boxed.groups[0].width === 5 && boxed.lines[0].t === 3 && boxed.lines[0].l === 6, "grouped by width, thickness then length");
const asDecimal = buildCheck(container, false);
ok(asDecimal.cft.ok === false && asDecimal.cft.diff > 0.5, "read as decimal feet the CFT comes out too high");

// the user's tally sheet: CFT printed for one piece, and a TOTAL that adds one piece per line
const tally: PurchaseRead = {
  title: "TIMBER MEASUREMENT & VOLUME TALLY SHEET",
  totals: { pcs: 43, cft: 2.472, cbm: 1.198 },
  lines: [
    { item: "130", l: "7", w: "5", t: "4", pcs: "42", cft: "0.972" },
    { item: "9", l: "4.5", w: "8", t: "6", pcs: "1", cft: "1.5" },
  ],
};
const tallyNote = guessNotation(tally);
ok(!tallyNote.ftIn && tallyNote.why === "cft", "4.5 stays four and a half feet when the CFT says so");
const tallied = buildCheck(tally);
ok(near(tallied.cft.ours, 42.333) && tallied.cft.ok === false && tallied.perPieceTotal, "their CFT total adds one piece per line");
ok(tallied.pcs.ok === true && tallied.cbm.ok === true, "pieces and CBM still agree");
ok(tallied.groups.map((g) => g.width).join() === "5,8", "one group per width");

// no CFT printed at all: only .3 and .9 endings mean inches
const plain = (ls: string[]): PurchaseRead => ({
  title: "",
  totals: { pcs: null, cft: null, cbm: null },
  lines: ls.map((l) => ({ item: "", l, w: "5", t: "3", pcs: "1", cft: "" })),
});
ok(guessNotation(plain(["6.3", "6.9", "7"])).why === "pattern" && guessNotation(plain(["6.3", "6.9"])).ftIn, ".3 and .9 endings mean inches");
ok(!guessNotation(plain(["6.5", "7"])).ftIn && !guessNotation(plain(["6.6"])).ftIn && !guessNotation(plain(["6", "7"])).ftIn, "other endings stay decimal");
ok(buildCheck(plain(["6", "7"])).cft.ok === null, "no supplier total means nothing to check");

const parsed = parsePurchaseRead({
  title: " MSDU ",
  totals: { pcs: "935", cft: "971.608", cbm: "" },
  lines: [{ l: "6.3", w: "5", t: "3", pcs: "18", cft: "11.719" }, { l: "", w: "5", t: "3", pcs: "2" }, null, { l: "7", w: "5", t: "3", pcs: "0" }],
});
ok(parsed.title === "MSDU" && parsed.lines.length === 1 && parsed.totals.pcs === 935 && parsed.totals.cft === 971.608 && parsed.totals.cbm === null, "lines need every size; totals become numbers");

ok(crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, "crc32 check value");
ok(colName(0) === "A" && colName(25) === "Z" && colName(26) === "AA", "column letters");

async function files() {
  const bytes = xlsxBytes([tallySheet(boxed)]);
  const back = await readSheetBytes("tally.xlsx", bytes);
  ok("read" in back && back.read.lines.length === 5 && back.read.lines.some((l) => l.l === "6.25"), "our Excel reads back as five lines in decimal feet");
  const again = await readPurchaseSheetBytes("tally.xlsx", bytes);
  ok(
    "read" in again && again.read.title === "MSDU2592526" && again.read.totals.pcs === 114 && near(again.read.totals.cft ?? 0, 83.993, 0.01),
    "the purchase reader finds our title and TOTAL row, not the supplier or difference rows",
  );

  const grid = [
    ["TIMBER MEASUREMENT & VOLUME TALLY SHEET"],
    [],
    ["Item No.", "Length (ft)", "Width (in)", "Thickness (in)", "Length (ft)", "Pcs", "Vol (CFT)", "Vol (CBM)"],
    ["130", "7", "5", "4", "7", "42", "0.972", "1.156"],
    ["9", "4.5", "8", "6", "4.5", "1", "1.5", "0.042"],
    ['• Width 9" Group •'],
    ["31", "8", "9", "6", "8", "1", "3", "0.085"],
    ["TOTAL", "", "", "", "", "44", "5.472", "1.283"],
  ];
  const fromGrid = purchaseFromGrid(grid);
  ok(fromGrid.title === "TIMBER MEASUREMENT & VOLUME TALLY SHEET" && fromGrid.lines.length === 3 && fromGrid.lines[0].item === "130", "tally sheet lines and item numbers");
  ok(fromGrid.totals.pcs === 44 && fromGrid.totals.cft === 5.472 && fromGrid.totals.cbm === 1.283, "tally sheet TOTAL row");
  ok(fromGrid.lines[0].cft === "0.972" && fromGrid.lines[2].w === "9", "their CFT per line is kept for the check");
}

files()
  .then(() => console.log(`purchase-check.check OK (${n} assertions)`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
