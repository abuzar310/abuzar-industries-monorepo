// Run: node --no-warnings packages/core/src/lib/sheet-import.check.ts
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  applySheetToDoc,
  gridFromXlsxParts,
  importKind,
  parseCsv,
  parseSheetGrid,
  readSheetBytes,
  sheetText,
} from "./sheet-import.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const sizes = (read: { lines: { name: string; l: string; w: string; t: string; pcs: string }[] }) =>
  read.lines.map((l) => [l.name, l.l, l.w, l.t, l.pcs]);

const headed = parseSheetGrid([
  ["L", "B", "H", "Pices"],
  ["8", "5", "3", "4"],
  ["9", "6", "2", "10"],
]);
assert.equal(headed.lines.length, 2);
assert.equal(headed.lines[0].l, "8");
assert.equal(headed.lines[0].w, "5");
assert.equal(headed.lines[0].t, "3");
assert.equal(headed.lines[0].pcs, "4");
assert.equal(headed.lines[1].pcs, "10");

const cross = parseSheetGrid([["Teak"], ["8x5x3x4"], ["9 × 6 × 2 × 10"]]);
assert.equal(cross.lines.length, 2);
assert.equal(cross.lines[0].name, "Teak");
assert.equal(cross.lines[0].pcs, "4");
assert.equal(cross.lines[1].l, "9");

const noHead = parseSheetGrid([
  ["8", "5", "3", "4"],
  ["Honne", "9", "6", "2", "1"],
]);
assert.equal(noHead.lines.length, 2);
assert.equal(noHead.lines[0].name, "Teak");
assert.equal(noHead.lines[1].name, "Honne");
assert.equal(noHead.lines[1].pcs, "1");

const grouped = parseSheetGrid([
  ["Wood", "L", "B", "H", "Pcs", "Rate"],
  ["Teak", "8", "5", "3", "4", "4200"],
  ["", "9", "6", "2", "2", ""],
  ["Honne", "7", "4", "2", "1", ""],
  ["", "6", "4", "2", "3", ""],
]);
assert.equal(grouped.lines[0].rate, "4200");
assert.equal(grouped.lines[0].name, "Teak");
assert.equal(grouped.lines[1].name, "Teak");
assert.equal(grouped.lines[2].name, "Honne");
assert.equal(grouped.lines[3].name, "Honne", "a blank wood cell keeps the wood above it");

const sized = parseSheetGrid([
  ["Size", "Qty"],
  ["8x5x3", "4"],
]);
assert.equal(sized.lines[0].l, "8");
assert.equal(sized.lines[0].pcs, "4");

const half = parseSheetGrid([
  ["L", "B", "H", "Pcs"],
  ["2", "1-5", "1-5", "6"],
]);
assert.equal(half.lines[0].w, "1.5");
assert.equal(half.lines[0].t, "1.5");

const named = parseSheetGrid([
  ["Customer", "Raju"],
  ["L", "B", "H", "Pcs"],
  ["8", "5", "3", "4"],
]);
assert.equal(named.customerName, "Raju");

const csv = parseSheetGrid(parseCsv('L,B,H,Pices\n8,5,3,4\n"9",6,2,10'));
assert.equal(csv.lines.length, 2);
assert.equal(csv.lines[1].l, "9");

const junk = parseSheetGrid([["Total", "100"], ["", "", "", ""]]);
assert.equal(junk.lines.length, 0);

// a real-world sheet: title rows, serial numbers, headings with units and spelling slips, extra columns, a total
const messy = parseSheetGrid([
  ["CUT SIZE TIMBER LIST"],
  ["Customer: Ramesh"],
  [],
  ["Sl No", "Particulars", "Length (ft)", "Breath (in)", "Thickness (in)", "No. of Pcs", "CFT", "Amount"],
  ["1", "Teak", "8", "5", "3", "4", "", ""],
  ["2", "", "9", "6", "2", "10", "", ""],
  ["3", "Honne", "7", "4", "2", "1", "", ""],
  ["", "Total", "", "", "", "15", "", ""],
]);
assert.equal(messy.customerName, "Ramesh");
assert.deepEqual(sizes(messy), [
  ["Teak", "8", "5", "3", "4"],
  ["Teak", "9", "6", "2", "10"],
  ["Honne", "7", "4", "2", "1"],
]);

const spelled = parseSheetGrid([
  ["S.No", "Item", "LENGTH", "WIDTH", "HEIGHT", "Qty", "Rate/CFT"],
  ["1", "Teak", "12", "6", "1", "2", "4200"],
]);
assert.deepEqual(sizes(spelled), [["Teak", "12", "6", "1", "2"]]);
assert.equal(spelled.lines[0].rate, "4200");

const shuffled = parseSheetGrid([
  ["Nos", "T", "W", "L", "#"],
  ["4", "3", "5", "8", "1"],
]);
assert.deepEqual(sizes(shuffled), [["Teak", "8", "5", "3", "4"]]);

const deep = parseSheetGrid([...Array.from({ length: 30 }, (_, i) => ["Note " + i]), ["L", "B", "H", "Pcs"], ["8", "5", "3", "4"]]);
assert.equal(deep.lines.length, 1, "the heading can sit far down the sheet");

// no heading: a column counting 1, 2, 3 is the serial number
const counted = parseSheetGrid([
  ["1", "8", "5", "3", "4"],
  ["2", "9", "6", "2", "10"],
  ["3", "7", "4", "2", "1"],
]);
assert.deepEqual(sizes(counted), [
  ["Teak", "8", "5", "3", "4"],
  ["Teak", "9", "6", "2", "10"],
  ["Teak", "7", "4", "2", "1"],
]);
assert.equal(parseSheetGrid([["8", "5", "3", "4", "4200"]]).lines.length, 0, "five numbers and no heading is left to the reader");

assert.equal(sheetText([["Teak wood order", ""], ["8 by 5 by 3", "4 nos"], [], ["", ""]]), "Teak wood order\n8 by 5 by 3 | 4 nos");

assert.equal(importKind({ name: "List.PDF", type: "" }), "pdf");
assert.equal(importKind({ name: "scan.bin", type: "application/pdf" }), "pdf");
assert.equal(importKind({ name: "IMG_1.HEIC", type: "" }), "image");
assert.equal(importKind({ name: "photo", type: "image/jpeg" }), "image");
assert.equal(importKind({ name: "cut.xlsx", type: "" }), "sheet");
assert.equal(importKind({ name: "old.xls", type: "application/vnd.ms-excel" }), "sheet");
assert.equal(importKind({ name: "sizes.csv", type: "text/csv" }), "sheet");
assert.equal(
  importKind({ name: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  "other",
);

const sheetXml = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1">
<c r="A1" t="s"><v>0</v></c>
<c r="B1" t="s"><v>1</v></c>
<c r="C1" t="s"><v>2</v></c>
<c r="D1" t="s"><v>3</v></c>
</row>
<row r="2">
<c r="A2"><v>8</v></c>
<c r="B2"><v>5</v></c>
<c r="C2"><v>3</v></c>
<c r="D2"><v>4</v></c>
</row>
</sheetData>
</worksheet>`;
const sharedXml = `<sst><si><t>L</t></si><si><t>B</t></si><si><t>H</t></si><si><t>Pices</t></si></sst>`;
const fromXml = parseSheetGrid(gridFromXlsxParts(sheetXml, sharedXml));
assert.equal(fromXml.lines[0].pcs, "4");

function u16(n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function cat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
function zipFiles(files: { name: string; data: Uint8Array }[], deflate: boolean) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const payload = deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const method = deflate ? 8 : 0;
    const local = cat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(payload.length),
      u32(f.data.length),
      u16(name.length),
      u16(0),
      name,
      payload,
    ]);
    locals.push(local);
    centrals.push(
      cat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(payload.length),
        u32(f.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const localBlob = cat(locals);
  const centralBlob = cat(centrals);
  return cat([
    localBlob,
    centralBlob,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBlob.length),
    u32(localBlob.length),
    u16(0),
  ]);
}

async function binaryCases() {
  const parts = [
    { name: "xl/worksheets/sheet1.xml", data: enc(sheetXml) },
    { name: "xl/sharedStrings.xml", data: enc(sharedXml) },
  ];
  const stored = await readSheetBytes("cut.xlsx", zipFiles(parts, false));
  assert.ok("read" in stored && stored.read.lines[0].l === "8" && stored.read.lines[0].pcs === "4");
  const deflated = await readSheetBytes("cut.xlsx", zipFiles(parts, true));
  assert.ok("read" in deflated && deflated.read.lines[0].pcs === "4");

  // the sizes sit on the second sheet, after a sheet of notes
  const notesXml = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Deliver on Monday</t></is></c></row></sheetData></worksheet>`;
  const two = await readSheetBytes(
    "two.xlsx",
    zipFiles(
      [
        { name: "xl/worksheets/sheet1.xml", data: enc(notesXml) },
        { name: "xl/worksheets/sheet2.xml", data: enc(sheetXml) },
        { name: "xl/sharedStrings.xml", data: enc(sharedXml) },
      ],
      true,
    ),
  );
  assert.ok("read" in two && two.read.lines.length === 1);

  const csvBytes = await readSheetBytes("sizes.csv", enc("L,B,H,Pcs\n8,5,3,4\n"));
  assert.ok("read" in csvBytes && csvBytes.read.lines[0].pcs === "4");

  // a layout the rules can't place goes to the reader as text
  const odd = await readSheetBytes("odd.csv", enc("Teak wood order\n8 by 5 by 3,4 nos\n"));
  assert.ok("text" in odd && odd.text === "Teak wood order\n8 by 5 by 3 | 4 nos");

  await assert.rejects(() => readSheetBytes("empty.csv", enc("\n\n")), /empty/);
  await assert.rejects(() => readSheetBytes("old.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), /Save As/);
}

const onto = applySheetToDoc(
  {
    id: "inv_keep",
    customerName: "Ismail",
    notes: "keep me",
    paperPhoto: "data:image/jpeg;base64,xx",
    sections: [{ name: "Teak", rate: 4000, rows: [{ l: "", w: "", t: "", pcs: "" }] }],
  } as never,
  { lines: headed.lines, customerName: "Other" },
);
assert.equal(onto.id, "inv_keep");
assert.equal(onto.customerName, "Ismail");
assert.equal(onto.listLayout, "dense");
assert.equal(onto.freeLayout, false);
assert.equal(onto.paperPhoto, "data:image/jpeg;base64,xx");
assert.equal(onto.sections[0].rows[0].pcs, "4");

binaryCases()
  .then(() => console.log("sheet-import.check OK"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
