// Run: npx tsx apps/excel/src/lib/csv.check.ts
import { csvFromSheet, parseCsv, snapshotFromCsv } from "./csv.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const rows = parseCsv('Length,Width,"Wood, kind"\r\n7,5,"Teak ""A"""\r\n4.5,8,Honne\r\n');
ok(rows.length === 3 && rows[0][2] === "Wood, kind", "quoted headers with commas");
ok(rows[1][2] === 'Teak "A"', "doubled quotes read back");
ok(parseCsv("a;b;c\n1;2;3")[1][1] === "2", "semicolons sniffed");
ok(parseCsv("a\tb\n1\t2")[1][1] === "2", "tabs sniffed");
ok(parseCsv("﻿x,y\n1,2")[0][0] === "x", "byte-order mark dropped");

const snap = snapshotFromCsv("Item,Length\n130,7\n9,4.5\n,text only\n");
const sheet = snap.sheets[snap.sheetOrder[0]];
ok(sheet.cellData[1][0].v === 130 && sheet.cellData[1][0].t === 2, "numeric text becomes a number");
ok(sheet.cellData[2][1].v === 4.5, "decimals too");
ok(sheet.cellData[0][0].v === "Item" && sheet.cellData[0][0].t === 1, "headers stay text");
ok(sheet.cellData[3][0] === undefined && sheet.cellData[3][1].v === "text only", "empty cells stay empty");

sheet.cellData[4] = { 0: { f: "=SUM(B2:B3)", v: "11.5", t: 2 }, 1: { v: 'say "hi", twice', t: 1 } };
const out = csvFromSheet(sheet, snap.styles);
const lines = out.split("\r\n");
ok(lines[0] === "Item,Length", "header line");
ok(lines[4] === '11.5,"say ""hi"", twice"', "a formula writes its value, quoting holds");
const round = parseCsv(out);
ok(round[1][0] === "130" && round[4][0] === "11.5", "csv round-trips through our own parser");

console.log(`excel csv.check OK (${n} assertions)`);
