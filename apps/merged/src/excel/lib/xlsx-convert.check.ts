// Run: npx tsx apps/excel/src/lib/xlsx-convert.check.ts
// Round-trips a workbook through real .xlsx bytes: ExcelJS → snapshot → ExcelJS → bytes → snapshot.
import ExcelJS from "exceljs";
import {
  charsFromPx,
  colName,
  excelFromSnapshot,
  pxFromChars,
  pxFromPoints,
  snapshotFromExcel,
  type UniSheet,
  type UniStyle,
  type XBook,
} from "./xlsx-convert.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};
const near = (a: number, b: number, d = 0.01) => Math.abs(a - b) <= d;

ok(pxFromChars(12) === 89 && near(charsFromPx(89), 12), "column width px and characters agree both ways");
ok(pxFromPoints(24) === 32, "row height points to px");
ok(colName(0) === "A" && colName(27) === "AB", "column names");

function timberBook(): ExcelJS.Workbook {
  // a small stand-in for the yard's tally sheets: merged title, bold header, formats, a formula
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tally");
  ws.getCell("A1").value = "TIMBER TALLY";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A1:C1");
  ws.getCell("A3").value = "Length";
  ws.getCell("A3").font = { bold: true, color: { argb: "FF15714A" } };
  ws.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF4EF" } };
  ws.getCell("A3").alignment = { horizontal: "center", wrapText: true };
  ws.getCell("A4").value = 5;
  ws.getCell("A5").value = 10;
  ws.getCell("A6").value = { formula: "SUM(A4:A5)", result: 15 };
  ws.getCell("B4").value = 40.833;
  ws.getCell("B4").numFmt = "0.000";
  ws.getCell("C4").value = "Teak";
  ws.getColumn(1).width = 12;
  ws.getRow(1).height = 24;
  const rates = wb.addWorksheet("Rates");
  rates.getCell("B2").value = 4200;
  return wb;
}

function firstSheet(snapId: ReturnType<typeof snapshotFromExcel>): UniSheet {
  return snapId.sheets[snapId.sheetOrder[0]];
}

async function run() {
  const snap = snapshotFromExcel(timberBook() as unknown as XBook);
  ok(snap.sheetOrder.length === 2, "both sheets came through");
  const s1 = firstSheet(snap);
  ok(s1.name === "Tally" && snap.sheets[snap.sheetOrder[1]].name === "Rates", "sheet names and order kept");
  ok(s1.cellData[0][0].v === "TIMBER TALLY", "title text");
  ok((s1.cellData[0][0].s as UniStyle).bl === 1 && (s1.cellData[0][0].s as UniStyle).fs === 14, "title bold and size");
  const head = s1.cellData[2][0].s as UniStyle;
  ok(head.cl?.rgb === "#15714A" && head.bg?.rgb === "#EEF4EF", "font and fill colours");
  ok(head.ht === 2 && head.tb === 3, "alignment and wrap");
  ok(s1.cellData[5][0].f === "=SUM(A4:A5)" && s1.cellData[5][0].v === 15, "formula and its cached result");
  ok((s1.cellData[3][1].s as UniStyle).n?.pattern === "0.000", "number format");
  ok(s1.mergeData.some((m) => m.startRow === 0 && m.endColumn === 2), "merge kept");
  ok(s1.columnData[0]?.w === 89, "column width in px");
  ok(s1.rowData[0]?.h === 32, "row height in px");

  // back out, then through real bytes, then in again
  snap.id = "wb-check";
  snap.name = "check";
  const out = new ExcelJS.Workbook();
  excelFromSnapshot(snap, out as unknown as XBook);
  const ws = out.getWorksheet("Tally")!;
  ok(String((ws.getCell("A6").value as { formula?: string })?.formula) === "SUM(A4:A5)", "formula written back");
  ok(ws.getCell("B4").numFmt === "0.000", "number format written back");
  ok(ws.getCell("A3").font?.bold === true, "bold written back");
  ok(near(Number(ws.getColumn(1).width), 12, 0.2), "column width written back");

  // Univer hands formatted numbers back as display text; Excel must still get numbers.
  const formatted = snapshotFromExcel(timberBook() as unknown as XBook);
  formatted.id = "wb-fmt";
  formatted.name = "fmt";
  const fs1 = firstSheet(formatted);
  fs1.cellData[3][1] = { v: "40.833", t: 2, s: { n: { pattern: "0.000" } } };
  fs1.cellData[4][0] = { v: "52,47,383", t: 2, s: { n: { pattern: "#,##,##0" } } };
  fs1.cellData[5][0] = { f: "=SUM(A4:A5)", v: "15", t: 2 };
  const outFmt = new ExcelJS.Workbook();
  excelFromSnapshot(formatted, outFmt as unknown as XBook);
  const wsFmt = outFmt.getWorksheet("Tally")!;
  ok(wsFmt.getCell("B4").value === 40.833, "display text 40.833 exports as the number");
  ok(wsFmt.getCell("A5").value === 5247383, "Indian-grouped display text exports as the number");
  ok((wsFmt.getCell("A6").value as { result?: unknown })?.result === 15, "a formula's cached text result exports as a number");

  const bytes = await out.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(bytes as ArrayBuffer);
  const snap2 = snapshotFromExcel(back as unknown as XBook);
  const t2 = firstSheet(snap2);
  ok(t2.cellData[5][0].f === "=SUM(A4:A5)" && t2.cellData[5][0].v === 15, "formula survives real bytes");
  ok(t2.cellData[3][1].v === 40.833 && (t2.cellData[3][1].s as UniStyle).n?.pattern === "0.000", "value and format survive real bytes");
  ok((t2.cellData[2][0].s as UniStyle).bg?.rgb === "#EEF4EF", "fill survives real bytes");
  ok(t2.mergeData.some((m) => m.startRow === 0 && m.endColumn === 2), "merge survives real bytes");
  ok(t2.columnData[0]?.w === 89 && t2.rowData[0]?.h === 32, "sizes survive real bytes");
  ok(snap2.sheets[snap2.sheetOrder[1]].cellData[1][1].v === 4200, "second sheet survives real bytes");
}

run()
  .then(() => console.log(`excel xlsx-convert.check OK (${n} assertions)`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
