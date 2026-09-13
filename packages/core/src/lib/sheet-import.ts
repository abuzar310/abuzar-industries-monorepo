import type { Doc } from "./types";
import {
  applyPaperToDoc,
  expandCrossSize,
  normalizePaperDim,
  paperQuoteSeed,
  parsePaperRead,
  type PaperLine,
  type PaperRead,
} from "./paper-quote";

export type { PaperLine, PaperRead };

const OLE = [0xd0, 0xcf, 0x11, 0xe0];

type ColKind = "l" | "w" | "t" | "pcs" | "wood" | "rate" | "size";
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

function normHead(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function classify(cell: string): ColKind | "" {
  const h = normHead(cell);
  if (!h) return "";
  if (["l", "length", "len", "lng"].includes(h)) return "l";
  if (["b", "breadth", "width", "w", "bth"].includes(h)) return "w";
  if (["h", "height", "thickness", "t", "ht", "thk"].includes(h)) return "t";
  if (["pices", "pice", "pieces", "piece", "pcs", "pc", "qty", "nos"].includes(h)) return "pcs";
  if (["wood", "item", "name", "particulars", "particular", "description", "timber", "species"].includes(h))
    return "wood";
  if (["rate", "rs", "price", "percft", "cftrate"].includes(h)) return "rate";
  if (["size", "sizes", "dimension", "dim", "lxbxh"].includes(h)) return "size";
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
  return /[a-zA-Z\u00C0-\u024F]/.test(t);
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

function rowToLoose(row: string[], cols: ColMap | null): Record<string, unknown> | null {
  if (!row.some((c) => String(c || "").trim())) return null;
  const blob = row.join(" ").trim();
  if (/^(total|grand)\b/i.test(blob)) return null;

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
    return { name: name || "Teak", l, w, t, pcs, rate };
  }

  for (const cell of row) {
    const four = expandCrossSize(cell);
    if (four) {
      const wood = row.find((c) => isWoodToken(c) && !expandSize(c));
      return { name: wood || "Teak", ...four };
    }
  }
  const woodAt = row.findIndex((c) => isWoodToken(c));
  const start = woodAt >= 0 ? woodAt + 1 : 0;
  const nums = numsFrom(row, start);
  if (nums.length >= 4) {
    return {
      name: woodAt >= 0 ? row[woodAt] : "Teak",
      l: nums[0],
      w: nums[1],
      t: nums[2],
      pcs: nums[3],
    };
  }
  if (woodAt >= 0 && nums.length === 0) return { name: row[woodAt] };
  const three = row.map((c) => expandSize(c)).find((x) => x && !("pcs" in x && x.pcs));
  if (three && nums.length === 1) {
    return { name: woodAt >= 0 ? row[woodAt] : "Teak", l: three.l, w: three.w, t: three.t, pcs: nums[0] };
  }
  return null;
}

/** L / B / H / Pices columns, or a wood heading then 8x5x3x4. Rate is per wood, not per row. */
export function parseSheetGrid(grid: string[][]): PaperRead {
  const rows = (grid || []).map((r) => (r || []).map((c) => String(c ?? "").trim()));
  let cols: ColMap | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const found = headerMap(rows[i]);
    if (found) {
      cols = found;
      start = i + 1;
      break;
    }
  }
  const lines: Record<string, unknown>[] = [];
  for (let i = start; i < rows.length; i++) {
    const loose = rowToLoose(rows[i], cols);
    if (loose) lines.push(loose);
  }
  return parsePaperRead({ customerName: pickCustomer(rows), lines });
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
  const re = /<(?:[A-Za-z0-9]+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?c>)/g;
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

export async function parseXlsxBytes(buf: Uint8Array): Promise<PaperRead> {
  const files = await unzip(buf);
  const sheets = files
    .filter((f) => /xl\/worksheets\/sheet\d+\.xml$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!sheets.length) throw new Error("No sheet found in that Excel file");
  const shared = files.find((f) => /xl\/sharedStrings\.xml$/i.test(f.name));
  const dec = new TextDecoder("utf-8");
  const grid = gridFromXlsxParts(dec.decode(sheets[0].bytes), shared ? dec.decode(shared.bytes) : "");
  const parsed = parseSheetGrid(grid);
  if (!parsed.lines.length) throw new Error("No sizes found in that sheet");
  return parsed;
}

export async function parseSheetBytes(name: string, buf: Uint8Array): Promise<PaperRead> {
  const lower = String(name || "").toLowerCase();
  if (looksOle(buf) || (lower.endsWith(".xls") && !lower.endsWith(".xlsx"))) {
    throw new Error("Save that file as .xlsx or CSV, then upload");
  }
  if (looksZip(buf) || /\.xlsx?m?$/.test(lower)) return parseXlsxBytes(buf);
  const text = new TextDecoder("utf-8").decode(buf);
  const parsed = parseSheetGrid(parseCsv(text));
  if (!parsed.lines.length) throw new Error("No sizes found in that file");
  return parsed;
}

export async function parseSheetFile(file: File): Promise<PaperRead> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return parseSheetBytes(file.name, buf);
}

/** Same open quote, plus the sheet lines. Always flips on the long-list print. */
export function applySheetToDoc(doc: Doc, opts: { lines: PaperLine[]; customerName: string }): Doc {
  return {
    ...applyPaperToDoc(doc, { lines: opts.lines, customerName: opts.customerName, paperPhoto: doc.paperPhoto || "" }),
    listLayout: "dense",
    freeLayout: false,
  };
}

export function sheetQuoteSeed(opts: { lines: PaperLine[]; customerName: string }): Partial<Doc> {
  return {
    ...paperQuoteSeed({ lines: opts.lines, customerName: opts.customerName, paperPhoto: "" }),
    notes: "From Excel",
    listLayout: "dense",
    freeLayout: false,
  };
}
