// The pure heart of .xlsx open and save: Univer's workbook snapshot on one side, an ExcelJS
// workbook on the other. No DOM, no worker glue, so the node check can round-trip real bytes.
//
// Carried both ways: values, formulas with their cached results, merges, column widths, row
// heights, number formats, bold/italic/underline/strike, font size/name/colour, fill colour,
// alignment, wrap, sheet names and order. Known limits live in NOTICE and the plan: charts,
// pivots and comments do not survive yet, and a shared-formula's follower cells import as
// their values (the anchor cell keeps the formula).

export type UniStyle = {
  bl?: number;
  it?: number;
  ul?: { s: number };
  st?: { s: number };
  fs?: number;
  ff?: string;
  cl?: { rgb: string };
  bg?: { rgb: string };
  ht?: number;
  vt?: number;
  tb?: number;
  n?: { pattern: string };
};
export type UniCell = { v?: string | number | boolean; f?: string; t?: number; s?: string | UniStyle | null };
export type UniMerge = { startRow: number; startColumn: number; endRow: number; endColumn: number };
export type UniSheet = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cellData: Record<number, Record<number, UniCell>>;
  mergeData: UniMerge[];
  columnData: Record<number, { w?: number }>;
  rowData: Record<number, { h?: number; ah?: number }>;
};
export type UniSnapshot = {
  id: string;
  name: string;
  locale?: string;
  styles: Record<string, UniStyle | undefined>;
  sheetOrder: string[];
  sheets: Record<string, UniSheet>;
};

// The slice of ExcelJS this module touches, kept structural so nothing here imports it.
type XColor = { argb?: string } | undefined;
type XFont = { bold?: boolean; italic?: boolean; underline?: boolean | string; strike?: boolean; size?: number; name?: string; color?: XColor };
type XFill = { type?: string; pattern?: string; fgColor?: XColor };
type XAlign = { horizontal?: string; vertical?: string; wrapText?: boolean };
export interface XCell {
  value: unknown;
  formula?: string;
  result?: unknown;
  numFmt?: string;
  font?: XFont;
  fill?: XFill;
  alignment?: XAlign;
}
interface XRow {
  number: number;
  height?: number;
  eachCell: (opts: { includeEmpty: boolean }, fn: (cell: XCell & { col: number }, col: number) => void) => void;
}
export interface XSheet {
  name: string;
  columns?: ({ width?: number } | undefined)[] | null;
  model?: { merges?: string[] };
  eachRow: (opts: { includeEmpty: boolean }, fn: (row: XRow, rowNumber: number) => void) => void;
  getCell: (row: number, col: number) => XCell;
  getColumn: (col: number) => { width?: number };
  getRow: (row: number) => { height?: number };
  mergeCells: (ref: string) => void;
}
export interface XBook {
  worksheets: XSheet[];
  addWorksheet: (name: string) => XSheet;
}

// Excel's units: column width is characters (~7px each plus 5px padding), row height is points.
export const pxFromChars = (chars: number) => Math.round(chars * 7 + 5);
export const charsFromPx = (px: number) => Math.round(((px - 5) / 7) * 100) / 100;
export const pxFromPoints = (pt: number) => Math.round((pt * 4) / 3);
export const pointsFromPx = (px: number) => Math.round(px * 0.75 * 100) / 100;

export const colName = (i: number): string => {
  let name = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) name = String.fromCharCode(65 + (n % 26)) + name;
  return name;
};
const colFromName = (name: string): number => {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const parseRef = (ref: string): { r: number; c: number } | null => {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  return m ? { r: parseInt(m[2], 10) - 1, c: colFromName(m[1]) } : null;
};

const rgbFromArgb = (color: XColor): string | null => {
  const argb = color && color.argb;
  return argb && argb.length >= 6 ? "#" + argb.slice(-6).toUpperCase() : null;
};
const argbFromRgb = (rgb: string): string => "FF" + rgb.replace("#", "").toUpperCase();

// Excel serial dates count days from 30 Dec 1899; the format string keeps them looking like dates.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const serialFromDate = (d: Date) => (d.getTime() - EXCEL_EPOCH) / 86400000;

const H_IN: Record<string, number> = { left: 1, center: 2, right: 3 };
const H_OUT: Record<number, string> = { 1: "left", 2: "center", 3: "right" };
const V_IN: Record<string, number> = { top: 1, middle: 2, bottom: 3 };
const V_OUT: Record<number, string> = { 1: "top", 2: "middle", 3: "bottom" };

function styleIn(cell: XCell): UniStyle | null {
  const s: UniStyle = {};
  const f = cell.font;
  if (f) {
    if (f.bold) s.bl = 1;
    if (f.italic) s.it = 1;
    if (f.underline) s.ul = { s: 1 };
    if (f.strike) s.st = { s: 1 };
    if (f.size && f.size !== 11) s.fs = f.size;
    if (f.name && f.name !== "Calibri") s.ff = f.name;
    const cl = rgbFromArgb(f.color);
    if (cl && cl !== "#000000") s.cl = { rgb: cl };
  }
  if (cell.fill && cell.fill.type === "pattern" && cell.fill.pattern === "solid") {
    const bg = rgbFromArgb(cell.fill.fgColor);
    if (bg) s.bg = { rgb: bg };
  }
  const a = cell.alignment;
  if (a) {
    if (a.horizontal && H_IN[a.horizontal]) s.ht = H_IN[a.horizontal];
    if (a.vertical && V_IN[a.vertical]) s.vt = V_IN[a.vertical];
    if (a.wrapText) s.tb = 3;
  }
  if (cell.numFmt && cell.numFmt !== "General") s.n = { pattern: cell.numFmt };
  return Object.keys(s).length ? s : null;
}

function valueIn(cell: XCell): { v?: string | number | boolean; f?: string; t?: number } {
  const out: { v?: string | number | boolean; f?: string; t?: number } = {};
  if (cell.formula) {
    out.f = "=" + cell.formula;
    const r = cell.result;
    if (typeof r === "number") {
      out.v = r;
      out.t = 2;
    } else if (typeof r === "string") {
      out.v = r;
      out.t = 1;
    } else if (typeof r === "boolean") {
      out.v = r;
      out.t = 3;
    } else if (r instanceof Date) {
      out.v = serialFromDate(r);
      out.t = 2;
    }
    return out;
  }
  const raw = cell.value;
  if (raw == null) return out;
  if (typeof raw === "number") {
    out.v = raw;
    out.t = 2;
  } else if (typeof raw === "boolean") {
    out.v = raw;
    out.t = 3;
  } else if (typeof raw === "string") {
    out.v = raw;
    out.t = 1;
  } else if (raw instanceof Date) {
    out.v = serialFromDate(raw);
    out.t = 2;
  } else if (typeof raw === "object") {
    const o = raw as { richText?: { text: string }[]; text?: unknown; result?: unknown; error?: string; sharedFormula?: string; hyperlink?: string };
    if (Array.isArray(o.richText)) {
      out.v = o.richText.map((p) => p.text).join("");
      out.t = 1;
    } else if (o.error) {
      out.v = o.error;
      out.t = 1;
    } else if (o.sharedFormula !== undefined || o.result !== undefined) {
      // a shared-formula follower: keep the value, the anchor keeps the formula
      const r = o.result;
      if (typeof r === "number") {
        out.v = r;
        out.t = 2;
      } else if (r != null) {
        out.v = String(r);
        out.t = 1;
      }
    } else if (o.text != null) {
      out.v = String(typeof o.text === "object" && o.text && "richText" in (o.text as object) ? ((o.text as { richText: { text: string }[] }).richText || []).map((p) => p.text).join("") : o.text);
      out.t = 1;
    }
  }
  return out;
}

/** ExcelJS workbook → a snapshot Univer can open. The caller names it and gives it a fresh id. */
export function snapshotFromExcel(wb: XBook): UniSnapshot {
  const sheets: Record<string, UniSheet> = {};
  const sheetOrder: string[] = [];
  wb.worksheets.forEach((ws, index) => {
    const id = "sheet-" + String(index + 1).padStart(2, "0");
    const cellData: Record<number, Record<number, UniCell>> = {};
    const rowData: Record<number, { h?: number; ah?: number }> = {};
    const columnData: Record<number, { w?: number }> = {};
    let maxRow = 0;
    let maxCol = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const r = rowNumber - 1;
      if (typeof row.height === "number") rowData[r] = { h: pxFromPoints(row.height), ah: pxFromPoints(row.height) };
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const c = col - 1;
        const uni: UniCell = valueIn(cell);
        const s = styleIn(cell);
        if (s) uni.s = s;
        if (uni.v === undefined && uni.f === undefined && !s) return;
        (cellData[r] ??= {})[c] = uni;
        if (r > maxRow) maxRow = r;
        if (c > maxCol) maxCol = c;
      });
    });
    (ws.columns || []).forEach((col, i) => {
      if (col && typeof col.width === "number") columnData[i] = { w: pxFromChars(col.width) };
    });
    const mergeData: UniMerge[] = [];
    for (const ref of ws.model?.merges || []) {
      const [a, b] = ref.split(":");
      const p1 = parseRef(a);
      const p2 = b ? parseRef(b) : p1;
      if (p1 && p2) mergeData.push({ startRow: p1.r, startColumn: p1.c, endRow: p2.r, endColumn: p2.c });
    }
    sheets[id] = {
      id,
      name: ws.name || "Sheet" + (index + 1),
      rowCount: Math.max(maxRow + 100, 200),
      columnCount: Math.max(maxCol + 26, 40),
      cellData,
      mergeData,
      columnData,
      rowData,
    };
    sheetOrder.push(id);
  });
  return { id: "", name: "", locale: "enUS", styles: {}, sheetOrder, sheets };
}

const resolveStyle = (styles: Record<string, UniStyle | undefined>, s: UniCell["s"]): UniStyle | null =>
  s == null ? null : typeof s === "string" ? styles[s] ?? null : s;

// Univer keeps a formatted cell's value as its display text ("52,47,383") while still typing it
// as a number. Excel must get the number back, or the cell turns to text and SUM skips it.
export function plainValue(uni: UniCell): string | number | boolean | undefined {
  const v = uni.v;
  if (uni.t === 2 && typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : v;
  }
  if (uni.t === 3 && typeof v === "string") return v.toUpperCase() === "TRUE";
  return v;
}

/** Snapshot → ExcelJS workbook. Excel reopens the result with formulas and formats alive. */
export function excelFromSnapshot(snap: UniSnapshot, wb: XBook): void {
  for (const sheetId of snap.sheetOrder) {
    const sheet = snap.sheets[sheetId];
    if (!sheet) continue;
    const ws = wb.addWorksheet(sheet.name || sheetId);
    for (const [rk, row] of Object.entries(sheet.cellData || {})) {
      const r = Number(rk);
      for (const [ck, uni] of Object.entries(row || {})) {
        const c = Number(ck);
        const cell = ws.getCell(r + 1, c + 1) as XCell;
        if (uni.f) {
          cell.value = { formula: uni.f.replace(/^=/, ""), result: plainValue(uni) as number | string | undefined };
        } else if (uni.v !== undefined) {
          cell.value = plainValue(uni);
        }
        const s = resolveStyle(snap.styles || {}, uni.s);
        if (s) {
          const font: XFont = {};
          if (s.bl === 1) font.bold = true;
          if (s.it === 1) font.italic = true;
          if (s.ul && s.ul.s === 1) font.underline = true;
          if (s.st && s.st.s === 1) font.strike = true;
          if (s.fs) font.size = s.fs;
          if (s.ff) font.name = s.ff;
          if (s.cl?.rgb) font.color = { argb: argbFromRgb(s.cl.rgb) };
          if (Object.keys(font).length) cell.font = font;
          if (s.bg?.rgb) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argbFromRgb(s.bg.rgb) } };
          const align: XAlign = {};
          if (s.ht && H_OUT[s.ht]) align.horizontal = H_OUT[s.ht];
          if (s.vt && V_OUT[s.vt]) align.vertical = V_OUT[s.vt];
          if (s.tb === 3) align.wrapText = true;
          if (Object.keys(align).length) cell.alignment = align;
          if (s.n?.pattern) cell.numFmt = s.n.pattern;
        }
      }
    }
    for (const [ck, col] of Object.entries(sheet.columnData || {})) {
      if (col && typeof col.w === "number") ws.getColumn(Number(ck) + 1).width = charsFromPx(col.w);
    }
    for (const [rk, row] of Object.entries(sheet.rowData || {})) {
      const px = row && (row.ah ?? row.h);
      if (typeof px === "number") ws.getRow(Number(rk) + 1).height = pointsFromPx(px);
    }
    for (const m of sheet.mergeData || []) {
      ws.mergeCells(colName(m.startColumn) + (m.startRow + 1) + ":" + colName(m.endColumn) + (m.endRow + 1));
    }
  }
}
