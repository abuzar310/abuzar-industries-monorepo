import type { Doc } from "./types";
import {
  applyPaperToDoc,
  expandCrossSize,
  normalizePaperDim,
  parsePaperRead,
  type PaperLine,
  type PaperRead,
} from "./paper-quote";
import { parsePurchaseRead, type PurchaseRead } from "./purchase-check";

export type { PaperLine, PaperRead };

/** Everything the import button takes. Old .xls is listed so picking one gets a clear message. */
export const IMPORT_ACCEPT =
  ".xlsx,.xlsm,.xls,.csv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,image/*,.heic,.heif";

export type ImportKind = "image" | "pdf" | "sheet" | "other";

export function importKind(file: { name: string; type: string }): ImportKind {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(name)) return "image";
  if (/\.(xlsx|xlsm|xls|csv|tsv|txt)$/.test(name) || /spreadsheet|excel|csv/.test(type)) return "sheet";
  return "other";
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0];

type ColKind = "l" | "w" | "t" | "pcs" | "wood" | "rate" | "size" | "serial" | "cft" | "cbm";
type ColMap = Partial<Record<ColKind, number>>;

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

const L_HEADS = new Set(["l", "len", "lng", "lenght", "length"]);
const W_HEADS = new Set(["b", "w", "br", "bth", "wd", "breadth", "breath", "bredth", "width", "wide"]);
const T_HEADS = new Set(["h", "t", "ht", "th", "thk", "height", "hight", "thick", "thickness"]);
const PCS_HEADS = new Set(["pcs", "pc", "pieces", "piece", "pices", "pice", "qty", "quantity", "nos"]);
const WOOD_HEADS = new Set(["wood", "item", "items", "name", "particulars", "particular", "description", "desc", "timber", "species", "material"]);
const SIZE_HEADS = new Set(["size", "sizes", "dimension", "dimensions", "dim", "lxbxh", "lxwxh", "lbh", "lwh"]);
const SERIAL_HEADS = new Set(["sl", "slno", "sno", "sr", "srno", "serial", "serialno", "sn", "no", "sino", "#", "itemno", "lotno", "logno"]);

/** What a heading names, however it is written: "Length (ft)", "Breath", "No. of Pcs", "Sl No". */
function classify(cell: string): ColKind | "" {
  const words = String(cell || "")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!words.length) return "";
  const joined = words.join("");
  const first = words[0];
  if (words.includes("rate") || first === "rs" || first === "price") return "rate";
  if (words.includes("cbm") || words.includes("m3")) return "cbm";
  if (words.includes("cft")) return "cft";
  if (words.some((w) => PCS_HEADS.has(w))) return "pcs";
  if (SERIAL_HEADS.has(joined)) return "serial";
  if (SIZE_HEADS.has(joined) || SIZE_HEADS.has(first)) return "size";
  if (L_HEADS.has(first)) return "l";
  if (W_HEADS.has(first)) return "w";
  if (T_HEADS.has(first)) return "t";
  if (WOOD_HEADS.has(first) || words.includes("particulars")) return "wood";
  return "";
}

function headerMap(row: string[]): ColMap | null {
  const m: ColMap = {};
  row.forEach((c, i) => {
    const k = classify(c);
    if (k && m[k] == null) m[k] = i;
  });
  const dims = (["l", "w", "t", "pcs"] as const).filter((k) => m[k] != null).length;
  if (m.size != null && (m.pcs != null || dims >= 1)) return m;
  if (dims >= 3) return m;
  if (m.wood != null && dims >= 2) return m;
  return null;
}

function isWoodToken(s: string): boolean {
  const t = String(s || "").trim();
  if (!t || /^\d/.test(t)) return false;
  if (classify(t)) return false;
  if (/^(total|grand|cft|sq\.?\s*ft|amount|amt)\b/i.test(t)) return false;
  return /[a-zA-ZÀ-ɏ]/.test(t);
}

function expandSize(raw: string): { l: string; w: string; t: string; pcs?: string } | null {
  const four = expandCrossSize(raw);
  if (four) return four;
  const parts = String(raw || "")
    .split(/\s*[x×]\s*/i)
    .map((p) => normalizePaperDim(p))
    .filter(Boolean);
  if (parts.length !== 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  return { l: parts[0], w: parts[1], t: parts[2] };
}

function numsFrom(row: string[], start: number): string[] {
  const out: string[] = [];
  for (let i = start; i < row.length; i++) {
    const n = normalizePaperDim(row[i]);
    if (/^\d+(\.\d+)?$/.test(n)) out.push(n);
    else if (out.length) break;
  }
  return out;
}

function pickCustomer(grid: string[][]): string {
  for (const row of grid.slice(0, 12)) {
    for (let i = 0; i < row.length; i++) {
      const c = String(row[i] || "").trim();
      const inline = c.match(/^(?:customer|party|name)\s*:\s*(.+)$/i);
      if (inline) return inline[1].trim();
      if (/^(customer|party|name)\s*:?\s*$/i.test(c)) {
        const next = String(row[i + 1] || "").trim();
        if (next && !classify(next)) return next;
      }
    }
  }
  return "";
}

/** A leading column that counts 1, 2, 3 down the rows is a serial number, not a length. */
function serialColumn(rows: string[][]): number {
  for (const c of [0, 1]) {
    const nums = rows
      .map((r) => String(r[c] ?? "").trim())
      .filter((v) => /^\d+$/.test(v))
      .map(Number);
    if (nums.length < 3 || nums[0] > 1) continue;
    let steps = 0;
    for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1] + 1) steps++;
    if (steps >= nums.length - 2) return c;
  }
  return -1;
}

/** One row as loose fields. The name stays empty when the row has none; the caller carries the wood down. */
function rowToLoose(row: string[], cols: ColMap | null): Record<string, unknown> | null {
  if (!row.some((c) => String(c || "").trim())) return null;
  const blob = row.join(" ").trim();
  if (/^(sub\s*total|total|grand|difference|supplier total)\b/i.test(blob)) return null;

  if (cols) {
    const name = cols.wood != null ? String(row[cols.wood] || "") : "";
    let l = cols.l != null ? String(row[cols.l] || "") : "";
    let w = cols.w != null ? String(row[cols.w] || "") : "";
    let t = cols.t != null ? String(row[cols.t] || "") : "";
    let pcs = cols.pcs != null ? String(row[cols.pcs] || "") : "";
    const rate = cols.rate != null ? String(row[cols.rate] || "") : "";
    if (cols.size != null) {
      const sized = expandSize(row[cols.size] || "");
      if (sized) {
        l = sized.l;
        w = sized.w;
        t = sized.t;
        if (sized.pcs) pcs = sized.pcs;
      }
    }
    if (!l && !w && !t) {
      for (const cell of row) {
        const sized = expandSize(cell);
        if (sized) {
          l = sized.l;
          w = sized.w;
          t = sized.t;
          if (sized.pcs && !pcs) pcs = sized.pcs;
          break;
        }
      }
    }
    return { name, l, w, t, pcs, rate };
  }

  for (const cell of row) {
    const four = expandCrossSize(cell);
    if (four) {
      const wood = row.find((c) => isWoodToken(c) && !expandSize(c));
      return { name: wood || "", ...four };
    }
  }
  const woodAt = row.findIndex((c) => isWoodToken(c));
  const start = woodAt >= 0 ? woodAt + 1 : 0;
  const nums = numsFrom(row, start);
  // five numbers with no heading could be a rate or a count: too unsure, so the reader decides
  if (nums.length > 4) return null;
  if (nums.length === 4) {
    return { name: woodAt >= 0 ? row[woodAt] : "", l: nums[0], w: nums[1], t: nums[2], pcs: nums[3] };
  }
  if (woodAt >= 0 && nums.length === 0) return { name: row[woodAt] };
  const three = row.map((c) => expandSize(c)).find((x) => x && !("pcs" in x && x.pcs));
  if (three && nums.length === 1) {
    return { name: woodAt >= 0 ? row[woodAt] : "", l: three.l, w: three.w, t: three.t, pcs: nums[0] };
  }
  return null;
}

/** Headings in any order and spelling (serial numbers skipped), or a wood heading then 8x5x3x4. Rate is per wood. */
export function parseSheetGrid(grid: string[][]): PaperRead {
  const rows = (grid || []).map((r) => (r || []).map((c) => String(c ?? "").trim()));
  let cols: ColMap | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const found = headerMap(rows[i]);
    if (found) {
      cols = found;
      start = i + 1;
      break;
    }
  }
  const serial = cols ? -1 : serialColumn(rows.slice(start));
  const lines: Record<string, unknown>[] = [];
  let wood = "";
  for (let i = start; i < rows.length; i++) {
    const row = serial < 0 ? rows[i] : rows[i].map((c, j) => (j === serial ? "" : c));
    const loose = rowToLoose(row, cols);
    if (!loose) continue;
    const named = String(loose.name || "").trim();
    if (named) wood = named;
    lines.push({ ...loose, name: named || wood || "Teak" });
  }
  return parsePaperRead({ customerName: pickCustomer(rows), lines });
}

/** Rows as text for the reader when the rules can't place the columns: one row per line, cells split by |. */
export function sheetText(grid: string[][], maxRows = 400): string {
  const out: string[] = [];
  for (const r of grid || []) {
    const cells = (r || []).map((c) => String(c ?? "").replace(/\s+/g, " ").trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (cells.length) out.push(cells.join(" | "));
    if (out.length >= maxRows) break;
  }
  return out.join("\n").slice(0, 40_000);
}

export function parseCsv(text: string): string[][] {
  let s = String(text || "");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const sample = s.slice(0, 800);
  const commas = (sample.match(/,/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  const tabs = (sample.match(/\t/g) || []).length;
  const delim = tabs > commas && tabs > semis ? "\t" : semis > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

function colOf(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function rowOf(ref: string): number {
  const n = parseInt(ref.replace(/^[A-Z]+/i, ""), 10);
  return Number.isFinite(n) ? n - 1 : -1;
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:[A-Za-z0-9]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const parts: string[] = [];
    const tRe = /<(?:[A-Za-z0-9]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(m[1]))) parts.push(xmlText(t[1]));
    out.push(parts.join(""));
  }
  return out;
}

export function gridFromXlsxParts(sheetXml: string, sharedXml = ""): string[][] {
  const shared = sharedXml ? sharedStrings(sharedXml) : [];
  const cells: { r: number; c: number; v: string }[] = [];
  // lazy, so an empty <c r="B1" s="13" /> ends at its own "/>" instead of swallowing the cells after it
  const re = /<(?:[A-Za-z0-9]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?c>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sheetXml))) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    const ref = /(?:\s|^)r="([^"]+)"/.exec(attrs)?.[1] || "";
    const r = rowOf(ref);
    const c = colOf(ref);
    if (r < 0 || c < 0) continue;
    const type = /(?:\s|^)t="([^"]+)"/.exec(attrs)?.[1] || "";
    let v = "";
    if (type === "s") {
      const idx = parseInt(xmlText(/<(?:[A-Za-z0-9]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?v>/.exec(body)?.[1] || ""), 10);
      v = Number.isFinite(idx) ? shared[idx] || "" : "";
    } else if (type === "inlineStr") {
      v = xmlText(body);
    } else {
      v = xmlText(/<(?:[A-Za-z0-9]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?v>/.exec(body)?.[1] || "");
    }
    cells.push({ r, c, v });
  }
  let maxR = 0;
  let maxC = 0;
  for (const cell of cells) {
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  const grid: string[][] = Array.from({ length: maxR + 1 }, () => Array<string>(maxC + 1).fill(""));
  for (const cell of cells) grid[cell.r][cell.c] = cell.v;
  return grid;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { inflateRawSync } = await import("node:zlib");
  return new Uint8Array(inflateRawSync(data));
}

type ZipFile = { name: string; bytes: Uint8Array };

function findEocd(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const from = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("That file is not a .xlsx");
}

async function unzip(buf: Uint8Array): Promise<ZipFile[]> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEocd(buf);
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const files: ZipFile[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) break;
    const method = view.getUint16(off + 10, true);
    const comp = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen)).replace(/\\/g, "/");
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtra = view.getUint16(localOff + 28, true);
    const data = buf.subarray(localOff + 30 + localNameLen + localExtra, localOff + 30 + localNameLen + localExtra + comp);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    let bytes = data;
    if (method === 8) bytes = await inflateRaw(data);
    else if (method !== 0) continue;
    files.push({ name, bytes });
  }
  return files;
}

function looksOle(buf: Uint8Array): boolean {
  return buf.length >= 4 && OLE.every((b, i) => buf[i] === b);
}

function looksZip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
}

/** Every sheet in the workbook, in order. */
async function xlsxGrids(buf: Uint8Array): Promise<string[][][]> {
  const files = await unzip(buf);
  const sheets = files
    .filter((f) => /xl\/worksheets\/sheet\d+\.xml$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!sheets.length) throw new Error("No sheet found in that Excel file");
  const shared = files.find((f) => /xl\/sharedStrings\.xml$/i.test(f.name));
  const dec = new TextDecoder("utf-8");
  const sharedXml = shared ? dec.decode(shared.bytes) : "";
  return sheets.map((s) => gridFromXlsxParts(dec.decode(s.bytes), sharedXml));
}

/** Lines when the rules can place the columns, otherwise the rows as text for the reader. */
export type SheetAttempt = { read: PaperRead } | { text: string };

function attemptGrids(grids: string[][][]): SheetAttempt {
  for (const grid of grids) {
    const read = parseSheetGrid(grid);
    if (read.lines.length) return { read };
  }
  const text = grids.map((g) => sheetText(g)).find(Boolean) || "";
  if (!text) throw new Error("That file is empty");
  return { text };
}

/** Every sheet of an Excel file, or the one grid of a CSV. */
export async function readSheetGrids(name: string, buf: Uint8Array): Promise<string[][][]> {
  const lower = String(name || "").toLowerCase();
  if (looksOle(buf) || (lower.endsWith(".xls") && !lower.endsWith(".xlsx"))) {
    throw new Error("Old .xls files can't be opened here. In Excel use Save As and pick .xlsx, or save it as a PDF.");
  }
  if (looksZip(buf) || /\.xlsx?m?$/.test(lower)) return xlsxGrids(buf);
  return [parseCsv(new TextDecoder("utf-8").decode(buf))];
}

export async function readSheetBytes(name: string, buf: Uint8Array): Promise<SheetAttempt> {
  return attemptGrids(await readSheetGrids(name, buf));
}

export async function readSheetFile(file: File): Promise<SheetAttempt> {
  return readSheetBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}

/** A supplier's list for a purchase check: sizes, item numbers, their CFT per line and their TOTAL row. */
export function purchaseFromGrid(grid: string[][]): PurchaseRead {
  const rows = (grid || []).map((r) => (r || []).map((c) => String(c ?? "").trim()));
  let cols: ColMap | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const found = headerMap(rows[i]);
    if (found) {
      cols = found;
      start = i + 1;
      break;
    }
  }
  const title = rows.slice(0, Math.max(0, start - 1)).map((r) => r.filter(Boolean).join(" ")).find(Boolean) || "";
  if (!cols) return parsePurchaseRead({ title, lines: [] });
  const map = cols;
  const at = (row: string[], k: ColKind) => (map[k] != null ? row[map[k] as number] || "" : "");
  const lines: Record<string, string>[] = [];
  let totals: Record<string, string> = {};
  let theirs: Record<string, string> | null = null;
  for (const row of rows.slice(start)) {
    const first = row.find(Boolean) || "";
    // our own Excel has TOTAL (ours) and then Supplier total (theirs), so reopening it keeps their figures
    if (/^(supplier )?total\b/i.test(first)) {
      const sums = { pcs: at(row, "pcs"), cft: at(row, "cft"), cbm: at(row, "cbm") };
      if (/^supplier/i.test(first)) theirs = sums;
      else totals = sums;
      continue;
    }
    if (/^(sub\s*total|grand|difference)\b/i.test(first)) continue;
    let l = at(row, "l");
    let w = at(row, "w");
    let t = at(row, "t");
    let pcs = at(row, "pcs");
    const sized = map.size != null ? expandSize(at(row, "size")) : null;
    if (sized) {
      l = sized.l;
      w = sized.w;
      t = sized.t;
      if (sized.pcs) pcs = sized.pcs;
    }
    lines.push({ item: at(row, "serial"), l, w, t, pcs, cft: at(row, "cft") });
  }
  return parsePurchaseRead({ title, lines, totals: theirs ?? totals });
}

/** The purchase check's local read: lines when the columns are clear, otherwise the rows as text for the reader. */
export async function readPurchaseSheetBytes(name: string, buf: Uint8Array): Promise<{ read: PurchaseRead } | { text: string }> {
  const grids = await readSheetGrids(name, buf);
  for (const grid of grids) {
    const read = purchaseFromGrid(grid);
    if (read.lines.length) return { read };
  }
  const text = grids.map((g) => sheetText(g)).find(Boolean) || "";
  if (!text) throw new Error("That file is empty");
  return { text };
}

/** Same open quote, plus the sheet lines. Always flips on the long-list print. */
export function applySheetToDoc(doc: Doc, opts: { lines: PaperLine[]; customerName: string }): Doc {
  return {
    ...applyPaperToDoc(doc, { lines: opts.lines, customerName: opts.customerName, paperPhoto: doc.paperPhoto || "" }),
    listLayout: "dense",
    freeLayout: false,
  };
}
