// The yard quotation they keep: QUOTATION, then Teak / White Teak / Neem blocks
// (SL No, L, W, T, Pieces, Feet = L×W×T×Pcs/144), Rate × CFT, GST 18%.
// A purchase list is a different layout — read the sizes and pour them into this one.

import { guessNotation, lengthFeet, parsePurchaseRead, purchaseNum } from "@/lib/purchase-check";
import { parseSheetGrid, purchaseFromGrid, readSheetGrids } from "@/lib/sheet-import";
import { pxFromChars, type UniCell, type UniSheet, type UniSnapshot, type UniStyle } from "./xlsx-convert";

export const YARD_WOODS = [
  { key: "teak", label: "TEAK", rate: 4000 },
  { key: "white-teak", label: "WHITE TEAK", rate: 2600 },
  { key: "neem", label: "NEEM", rate: 1000 },
] as const;

const MIN_ROWS = 11;
const HEAD = ["SL No", "L", "W", "T", "Pieces", "Feet"] as const;
const COL_CHARS = [6.8, 7.4, 6.3, 7.2, 7.2, 12.8, 12.4];
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const bold: UniStyle = { bl: 1 };
const feetStyle: UniStyle = { bl: 1, n: { pattern: "0.00" } };
const money: UniStyle = { n: { pattern: "#,##0.00" } };
const dateStyle: UniStyle = { n: { pattern: "dd/mm/yy" } };

const text = (v: string, s?: UniStyle): UniCell => (s ? { v, t: 1, s } : { v, t: 1 });
const num = (v: number, s?: UniStyle): UniCell => (s ? { v, t: 2, s } : { v, t: 2 });
const formula = (f: string, s?: UniStyle): UniCell => (s ? { f, t: 2, s } : { f, t: 2 });

function newId() {
  return "wb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todaySerial() {
  return (Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - EXCEL_EPOCH) / 86400000;
}

function clean(s: string) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Their quotation — not a supplier packing list. */
export function isYardFormat(grid: string[][]): boolean {
  const flat = (grid || []).flat().map((c) => clean(String(c ?? "")));
  const hasWood = flat.some((c) => c === "TEAK" || c === "WHITE TEAK" || c === "NEEM");
  const hasQuote = flat.includes("QUOTATION");
  const hasFeet = flat.includes("FEET");
  const hasSl = flat.some((c) => c === "SL NO" || c === "SLNO");
  return hasWood && (hasQuote || (hasFeet && hasSl));
}

export function woodKey(name: string): string {
  const t = clean(name);
  if (/\bWHITE TEAK\b/.test(t) || t === "W TEAK" || t === "WT") return "white-teak";
  if (/\bNEEM\b/.test(t)) return "neem";
  if (/\bTEAK\b/.test(t)) return "teak";
  return t.toLowerCase().replace(/\s+/g, "-") || "teak";
}

export function woodLabel(key: string): string {
  return YARD_WOODS.find((w) => w.key === key)?.label || key.replace(/-/g, " ").toUpperCase();
}

function woodFromTitle(title: string): string | null {
  const t = clean(title);
  if (/\bWHITE TEAK\b/.test(t)) return "WHITE TEAK";
  if (/\bNEEM\b/.test(t)) return "NEEM";
  if (/\bTEAK\b/.test(t)) return "TEAK";
  return null;
}

function defaultRate(key: string): number {
  return YARD_WOODS.find((w) => w.key === key)?.rate ?? 4000;
}

export type YardLine = { name: string; l: string; w: string; t: string; pcs: string; rate: string };

function linesFromGrid(grid: string[][]): YardLine[] {
  const paper = parseSheetGrid(grid);
  if (paper.lines.length) {
    return paper.lines.map((l) => ({ name: l.name, l: l.l, w: l.w, t: l.t, pcs: l.pcs, rate: l.rate }));
  }
  const buy = purchaseFromGrid(grid);
  if (!buy.lines.length) return [];
  const name = woodFromTitle(buy.title) || "Teak";
  return buy.lines.map((x) => ({ name, l: x.l, w: x.w, t: x.t, pcs: x.pcs, rate: "" }));
}

type Sized = { l: number; w: number; t: number; pcs: number; rate: number | null };

function sizeLines(lines: YardLine[]): { key: string; rate: number; rows: Sized[] }[] {
  const read = parsePurchaseRead({
    title: "",
    lines: lines.map((l) => ({ item: "", l: l.l, w: l.w, t: l.t, pcs: l.pcs, cft: "" })),
    totals: {},
  });
  const ftIn = guessNotation(read).ftIn;
  const groups = new Map<string, { rate: number | null; rows: Sized[] }>();
  const order: string[] = [];
  for (const line of lines) {
    const key = woodKey(line.name);
    if (!groups.has(key)) {
      groups.set(key, { rate: null, rows: [] });
      order.push(key);
    }
    const g = groups.get(key)!;
    const rate = purchaseNum(line.rate);
    if (g.rate == null && rate) g.rate = rate;
    g.rows.push({
      l: lengthFeet(line.l, ftIn),
      w: purchaseNum(line.w) ?? 0,
      t: purchaseNum(line.t) ?? 0,
      pcs: purchaseNum(line.pcs) ?? 0,
      rate,
    });
  }
  const keys = [...YARD_WOODS.map((w) => w.key), ...order.filter((k) => !YARD_WOODS.some((w) => w.key === k))];
  return keys.map((key) => {
    const g = groups.get(key);
    return { key, rate: g?.rate ?? defaultRate(key), rows: g?.rows ?? [] };
  });
}

function put(cells: UniSheet["cellData"], r: number, c: number, cell: UniCell) {
  (cells[r] ??= {})[c] = cell;
}

export function buildYardSnapshot(lines: YardLine[], id = newId(), name = "Yard sheet"): UniSnapshot {
  const woods = sizeLines(lines);
  const cells: UniSheet["cellData"] = {};
  put(cells, 0, 2, text("QUOTATION", bold));
  put(cells, 1, 4, text("DATE", bold));
  put(cells, 1, 5, num(todaySerial(), dateStyle));

  let r = 2;
  const amountRows: number[] = [];
  for (const wood of woods) {
    put(cells, r, 2, text(woodLabel(wood.key), bold));
    r += 1;
    HEAD.forEach((h, c) => put(cells, r, c, text(h, bold)));
    r += 1;
    const data = Math.max(MIN_ROWS, wood.rows.length);
    const first = r;
    for (let i = 0; i < data; i++) {
      const excel = r + 1;
      put(cells, r, 0, num(i + 1));
      const row = wood.rows[i];
      if (row) {
        put(cells, r, 1, num(row.l));
        put(cells, r, 2, num(row.w));
        put(cells, r, 3, num(row.t));
        put(cells, r, 4, num(row.pcs));
      }
      put(cells, r, 5, formula("=(B" + excel + "*C" + excel + "*D" + excel + "*E" + excel + ")/144", feetStyle));
      r += 1;
    }
    const last = r;
    put(cells, r, 2, text("Rate", bold));
    put(cells, r, 3, num(wood.rate, bold));
    put(cells, r, 4, text("Total", bold));
    put(cells, r, 5, formula("=SUM(F" + (first + 1) + ":F" + last + ")", feetStyle));
    put(cells, r, 6, formula("=D" + (r + 1) + "*F" + (r + 1), money));
    amountRows.push(r + 1);
    r += 1;
  }

  r += 1;
  const totalAt = r + 1;
  put(cells, r, 5, text("TOTAL", bold));
  put(cells, r, 6, formula("=" + amountRows.map((n) => "G" + n).join("+"), money));
  r += 1;
  put(cells, r, 5, text("GST 18%", bold));
  put(cells, r, 6, formula("=G" + totalAt + "*18%", money));
  r += 1;
  put(cells, r, 5, text("GRAND TOTAL", bold));
  put(cells, r, 6, formula("=SUM(G" + totalAt + ":G" + (totalAt + 1) + ")", money));

  const columnData: UniSheet["columnData"] = {};
  COL_CHARS.forEach((w, i) => {
    columnData[i] = { w: pxFromChars(w) };
  });

  const sheet: UniSheet = {
    id: "sheet-01",
    name: "Sheet1",
    rowCount: Math.max(r + 100, 200),
    columnCount: 40,
    cellData: cells,
    mergeData: [{ startRow: 0, startColumn: 2, endRow: 0, endColumn: 4 }],
    columnData,
    rowData: {},
  };
  return { id, name, locale: "enUS", styles: {}, sheetOrder: [sheet.id], sheets: { [sheet.id]: sheet } };
}

export function emptyYardSnapshot(id = newId(), name = "Yard sheet"): UniSnapshot {
  return buildYardSnapshot([], id, name);
}

/** Purchase / supplier list → our yard sheet. Already-our-format files stay untouched (null). */
export function yardFromGrid(grid: string[][]): UniSnapshot | null {
  if (isYardFormat(grid)) return null;
  const lines = linesFromGrid(grid);
  if (!lines.length) return null;
  return buildYardSnapshot(lines);
}

export async function yardFromSheetBytes(fileName: string, buf: Uint8Array): Promise<UniSnapshot | null> {
  const grids = await readSheetGrids(fileName, buf);
  for (const grid of grids) {
    if (isYardFormat(grid)) return null;
  }
  for (const grid of grids) {
    const snap = yardFromGrid(grid);
    if (snap) return snap;
  }
  return null;
}
