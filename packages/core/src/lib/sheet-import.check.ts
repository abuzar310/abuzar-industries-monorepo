// Run: node --no-warnings packages/core/src/lib/sheet-import.check.ts
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  applySheetToDoc,
  gridFromXlsxParts,
  parseCsv,
  parseSheetBytes,
  parseSheetGrid,
  parseXlsxBytes,
  sheetQuoteSeed,
} from "./sheet-import.ts";

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
]);
assert.equal(grouped.lines[0].rate, "4200");
assert.equal(grouped.lines[0].name, "Teak");
assert.equal(grouped.lines[1].name, "Teak");
assert.equal(grouped.lines[2].name, "Honne");

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

const csv = parseSheetGrid(
  parseCsv('L,B,H,Pices\n8,5,3,4\n"9",6,2,10'),
);
assert.equal(csv.lines.length, 2);
assert.equal(csv.lines[1].l, "9");

const junk = parseSheetGrid([["Total", "100"], ["", "", "", ""]]);
assert.equal(junk.lines.length, 0);

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
    { name: "xl/worksheets/sheet1.xml", data: new TextEncoder().encode(sheetXml) },
    { name: "xl/sharedStrings.xml", data: new TextEncoder().encode(sharedXml) },
  ];
  const xlsx = await parseXlsxBytes(zipFiles(parts, false));
  assert.equal(xlsx.lines[0].l, "8");
  assert.equal(xlsx.lines[0].pcs, "4");
  const deflated = await parseXlsxBytes(zipFiles(parts, true));
  assert.equal(deflated.lines[0].pcs, "4");

  const csvBytes = await parseSheetBytes("sizes.csv", new TextEncoder().encode("L,B,H,Pcs\n8,5,3,4\n"));
  assert.equal(csvBytes.lines[0].pcs, "4");

  await assert.rejects(
    () => parseSheetBytes("old.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])),
    /xlsx or CSV/,
  );
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

const seed = sheetQuoteSeed({ lines: headed.lines, customerName: "  Raju  " });
assert.equal(seed.customerName, "Raju");
assert.equal(seed.listLayout, "dense");
assert.equal(seed.notes, "From Excel");

binaryCases()
  .then(() => console.log("sheet-import.check OK"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
