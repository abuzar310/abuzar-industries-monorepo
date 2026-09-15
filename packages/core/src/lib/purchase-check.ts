import { CBM_TO_CFT } from "./calc";
import { normalizePaperDim } from "./paper-quote";
import type { XlsxRow, XlsxSheet } from "./xlsx-write";

// A supplier's measurement list (packing list, tally sheet, container list) turned into our L (ft) / W (in) / T (in) /
// Pcs, with our totals checked against the totals printed on their list. Nothing is saved; the PDF and Excel are the record.

/** One line as the supplier printed it. Lengths stay as written so 6.3 can be read as 6 ft 3 in. */
export type PurchaseRawLine = { item: string; l: string; w: string; t: string; pcs: string; cft: string };
export type PurchaseTotals = { pcs: number | null; cft: number | null; cbm: number | null };
export type PurchaseRead = { title: string; lines: PurchaseRawLine[]; totals: PurchaseTotals };

/** "1,234.5" → 1234.5, "1-5" or "1,5" → 1.5, blank or text → null. */
export function purchaseNum(v: unknown): number | null {
  let s = String(v ?? "").trim().replace(/\s+/g, "");
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  s = normalizePaperDim(s);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const positive = (v: string) => (purchaseNum(v) ?? 0) > 0;

/** Keep only lines that have a length, width, thickness and piece count. */
export function parsePurchaseRead(raw: unknown): PurchaseRead {
  const o = (raw && typeof raw === "object" ? raw : {}) as { title?: unknown; lines?: unknown; totals?: unknown };
  const lines: PurchaseRawLine[] = [];
  for (const r of Array.isArray(o.lines) ? o.lines : []) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const pick = (k: string) => normalizePaperDim(String(x[k] ?? "").trim());
    const line = { item: String(x.item ?? "").trim(), l: pick("l"), w: pick("w"), t: pick("t"), pcs: pick("pcs"), cft: pick("cft") };
    if (positive(line.l) && positive(line.w) && positive(line.t) && positive(line.pcs)) lines.push(line);
  }
  const t = (o.totals && typeof o.totals === "object" ? o.totals : {}) as Record<string, unknown>;
  return {
    title: String(o.title ?? "").trim(),
    lines,
    totals: { pcs: purchaseNum(t.pcs), cft: purchaseNum(t.cft), cbm: purchaseNum(t.cbm) },
  };
}

/** Length in feet. Read as feet.inches, 6.3 is 6 ft 3 in (6.25) and 6.10 is 6 ft 10 in. */
export function lengthFeet(raw: string, ftIn: boolean): number {
  const n = purchaseNum(raw) ?? 0;
  if (!ftIn) return n;
  const m = String(raw).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return n;
  const inches = m[2] ? Number(m[2]) : 0;
  return inches < 12 ? Number(m[1]) + inches / 12 : n;
}

const lineCft = (l: number, w: number, t: number, pcs: number) => (l * w * t * pcs) / 144;
const lineOf = (x: PurchaseRawLine, ftIn: boolean) =>
  lineCft(lengthFeet(x.l, ftIn), purchaseNum(x.w) ?? 0, purchaseNum(x.t) ?? 0, purchaseNum(x.pcs) ?? 0);

/** How the lengths were written: proven by the supplier's own CFT when the list has it, else by the .3 .6 .9 pattern. */
export type Notation = { ftIn: boolean; why: "cft" | "total" | "pattern" | "none" };

export function guessNotation(read: PurchaseRead): Notation {
  const fractional = read.lines.filter((x) => /\.\d/.test(x.l));
  if (!fractional.length) return { ftIn: false, why: "none" };
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.01);
  const hits = (ftIn: boolean) =>
    read.lines.filter((x) => {
      const given = purchaseNum(x.cft);
      if (!given) return false;
      const cft = lineOf(x, ftIn);
      // some lists print the CFT of one piece, others of the whole line
      return near(cft, given) || near(cft / (purchaseNum(x.pcs) || 1), given);
    }).length;
  const asDecimal = hits(false);
  const asInches = hits(true);
  if (asDecimal !== asInches) return { ftIn: asInches > asDecimal, why: "cft" };
  const total = read.totals.cft;
  if (total) {
    const off = (ftIn: boolean) => Math.abs(read.lines.reduce((s, x) => s + lineOf(x, ftIn), 0) - total);
    if (Math.abs(off(false) - off(true)) > total * 0.001) return { ftIn: off(true) < off(false), why: "total" };
  }
  const endings = new Set(fractional.map((x) => x.l.split(".")[1]));
  const inchLike = [...endings].every((e) => e === "3" || e === "6" || e === "9") && (endings.has("3") || endings.has("9"));
  return { ftIn: inchLike, why: inchLike ? "pattern" : "none" };
}

/** at is where the line sits in their list, so a change made on the sorted sheet lands on the right line. */
export type CheckLine = { at: number; item: string; l: number; w: number; t: number; pcs: number; cft: number; cbm: number };
export type CheckGroup = { width: number; lines: CheckLine[]; pcs: number; cft: number; cbm: number };
/** ok is null when the supplier printed no total to check against. */
export type TotalCheck = { ours: number; theirs: number | null; ok: boolean | null; diff: number };
export type PurchaseCheck = {
  title: string;
  ftIn: boolean;
  lines: CheckLine[];
  groups: CheckGroup[];
  pcs: TotalCheck;
  cft: TotalCheck;
  cbm: TotalCheck;
  /** Their CFT total adds up one piece per line instead of every piece. */
  perPieceTotal: boolean;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function compare(ours: number, theirs: number | null, slack: number, share: number): TotalCheck {
  if (theirs === null) return { ours, theirs, ok: null, diff: 0 };
  const diff = ours - theirs;
  return { ours, theirs, ok: Math.abs(diff) <= Math.max(slack, Math.abs(theirs) * share), diff };
}

export function buildCheck(read: PurchaseRead, ftIn = guessNotation(read).ftIn): PurchaseCheck {
  const lines: CheckLine[] = read.lines
    .map((x, at) => {
      const l = lengthFeet(x.l, ftIn);
      const w = purchaseNum(x.w) ?? 0;
      const t = purchaseNum(x.t) ?? 0;
      const pcs = purchaseNum(x.pcs) ?? 0;
      const cft = lineCft(l, w, t, pcs);
      return { at, item: x.item, l, w, t, pcs, cft, cbm: cft / CBM_TO_CFT };
    })
    .sort((a, b) => a.w - b.w || a.t - b.t || a.l - b.l);
  const groups: CheckGroup[] = [];
  for (const line of lines) {
    let g = groups[groups.length - 1];
    if (!g || g.width !== line.w) {
      g = { width: line.w, lines: [], pcs: 0, cft: 0, cbm: 0 };
      groups.push(g);
    }
    g.lines.push(line);
    g.pcs += line.pcs;
    g.cft += line.cft;
    g.cbm += line.cbm;
  }
  const pcs = lines.reduce((s, x) => s + x.pcs, 0);
  const cft = lines.reduce((s, x) => s + x.cft, 0);
  const theirCft = read.totals.cft;
  const cftCheck = compare(cft, theirCft, 0.5, 0.005);
  const onePieceEach = lines.reduce((s, x) => s + (x.pcs ? x.cft / x.pcs : 0), 0);
  return {
    title: read.title,
    ftIn,
    lines,
    groups,
    pcs: compare(pcs, read.totals.pcs, 0.5, 0),
    cft: cftCheck,
    cbm: compare(cft / CBM_TO_CFT, read.totals.cbm, 0.02, 0.005),
    perPieceTotal: theirCft !== null && cftCheck.ok === false && Math.abs(onePieceEach - theirCft) <= Math.max(0.5, theirCft * 0.005),
  };
}

const inchLabel = (n: number) => r3(n) + '"';

/** The tally in our format: Item No, Length (ft), Width (in), Thickness (in), Pcs, CFT, CBM, grouped by width. */
export function tallySheet(check: PurchaseCheck): XlsxSheet {
  const rows: XlsxRow[] = [{ cells: [check.title || "Timber measurement & volume tally"], bold: true, span: 7 }];
  if (check.ftIn) rows.push({ cells: ["Lengths read as feet.inches: 6.3 means 6 ft 3 in"], span: 7 });
  rows.push({ cells: [] });
  rows.push({
    cells: ["Item No.", "Length (ft)", "Width (in)", "Thickness (in)", "Pcs", "Vol (CFT)", "Vol (CBM)"],
    bold: true,
  });
  for (const g of check.groups) {
    rows.push({ cells: ["Width " + inchLabel(g.width) + " group"], bold: true, span: 7 });
    for (const x of g.lines) rows.push({ cells: [x.item, r3(x.l), x.w, x.t, x.pcs, r3(x.cft), r3(x.cbm)] });
    rows.push({ cells: ["Subtotal", "", "", "", g.pcs, r3(g.cft), r3(g.cbm)], bold: true });
  }
  rows.push({ cells: ["TOTAL", "", "", "", check.pcs.ours, r3(check.cft.ours), r3(check.cbm.ours)], bold: true });
  // written even when their list has no totals, so reopening this file never takes our TOTAL for theirs
  rows.push({ cells: ["Supplier total", "", "", "", check.pcs.theirs, check.cft.theirs, check.cbm.theirs] });
  rows.push({
    cells: [
      "Difference",
      "",
      "",
      "",
      check.pcs.theirs === null ? null : r3(check.pcs.diff),
      check.cft.theirs === null ? null : r3(check.cft.diff),
      check.cbm.theirs === null ? null : r3(check.cbm.diff),
    ],
  });
  return { name: "Tally", widths: [12, 12, 12, 14, 8, 12, 12], rows, threeDecimals: [5, 6] };
}
