import type { Doc, Section } from "./types";

/** One row on the review list. Tick = include. Nothing is saved until Confirm. */
export type PaperLine = {
  keep: boolean;
  name: string;
  l: string;
  w: string;
  t: string;
  pcs: string;
  rate: string;
};

export type PaperRead = {
  customerName: string;
  lines: PaperLine[];
};

/** Yard lists: wood name, then L×B×H×pcs or columns "L B H Pices". B = width, H = thickness. */
export const PAPER_READ_PROMPT =
  "Read this handwritten timber size list (lined notebook, blue pen, iPhone photo). Return JSON only: " +
  '{"customerName":"","lines":[{"name":"Teak","l":"8","w":"5","t":"3","pcs":"4","rate":""}]} ' +
  "Yard format — two layouts. " +
  "A) Wood name on its own line (Teak, Honne, …) then L×B×H×pcs like 8 × 5 × 3 × 4 or 8x5x3x4. " +
  "B) Header L B H Pices (they spell it Pices, not Pieces) then four numbers per row. " +
  "Map: L→l, B (breadth)→w, H→t, Pices/Pieces/Pcs→pcs. Wood name applies downward until another wood. No wood → Teak. " +
  "1-5 or 1,5 means 1.5. Their handwritten 2 is two short strokes and often looks like 11 — if the glyph is two uprights with no crossbar, read 2 not 11 (especially in H or Pices). " +
  "Skip the L B H Pices header, doodles, and stray marks. Do not invent sizes. No rate unless ₹ is written. " +
  "customerName only if a person's name is clearly on the paper. " +
  "Examples: Teak / 8×5×3×4 / 9×6×2×10 → two Teak lines (skip any L B H Pices under them). " +
  "Columns 5 2 3 10 / 8 9 2 5 / 7 6 2 2 / 2 1-5 1-5 6 → four Teak lines, last w=1.5 t=1.5 pcs=6.";

export function blankPaperLine(): PaperLine {
  return { keep: true, name: "Teak", l: "", w: "", t: "", pcs: "", rate: "" };
}

export function paperLineHasSize(line: PaperLine): boolean {
  return [line.l, line.w, line.t, line.pcs].some((x) => String(x ?? "").trim() !== "");
}

/** 1-5 / 1,5 → 1.5 (how they write half-inches). */
export function normalizePaperDim(raw: string): string {
  const s = String(raw ?? "").trim().replace(",", ".");
  const m = s.match(/^(\d+)-(\d{1,2})$/);
  if (m) return m[1] + "." + m[2];
  return s;
}

function cell(v: unknown): string {
  if (v == null) return "";
  return normalizePaperDim(String(v).trim());
}

function isHeaderLine(line: PaperLine): boolean {
  const blob = [line.name, line.l, line.w, line.t, line.pcs].join(" ").toLowerCase();
  if (/\bpices?\b|\bpieces?\b/.test(blob) && !/\d/.test(blob)) return true;
  return /^(l|b|h|w|t|pcs)$/i.test(line.name.trim());
}

/** "8x5x3x4" or "8 × 5 × 3 × 4" dumped in one field. */
export function expandCrossSize(raw: string): { l: string; w: string; t: string; pcs: string } | null {
  const parts = String(raw || "")
    .split(/\s*[x×]\s*/i)
    .map((p) => normalizePaperDim(p))
    .filter(Boolean);
  if (parts.length !== 4) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  return { l: parts[0], w: parts[1], t: parts[2], pcs: parts[3] };
}

function extractJson(text: string): unknown {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty AI reply");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI reply was not JSON");
  return JSON.parse(body.slice(start, end + 1));
}

function tidyLine(r: Record<string, unknown>): PaperLine {
  const line: PaperLine = {
    keep: r.keep === false ? false : true,
    name: cell(r.name) || "Teak",
    l: cell(r.l),
    w: cell(r.w),
    t: cell(r.t),
    pcs: cell(r.pcs),
    rate: cell(r.rate),
  };
  if (!paperLineHasSize(line)) {
    const cross = expandCrossSize(String(r.name || r.size || r.line || ""));
    if (cross) Object.assign(line, cross, { name: "Teak" });
  }
  return line;
}

export function parsePaperRead(raw: unknown): PaperRead {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(o.lines) ? o.lines : [];
  const lines: PaperLine[] = [];
  let wood = "";
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const line = tidyLine(row as Record<string, unknown>);
    if (isHeaderLine(line)) continue;
    if (!paperLineHasSize(line) && line.name && !/^\d/.test(line.name)) {
      wood = line.name;
      continue;
    }
    if (!paperLineHasSize(line)) continue;
    if (wood && (!line.name || line.name === "Teak")) line.name = wood;
    if (line.name && !/^\d/.test(line.name) && line.name.toLowerCase() !== "teak") wood = line.name;
    lines.push(line);
  }
  return { customerName: cell(o.customerName), lines };
}

export function parsePaperAiJson(text: string): PaperRead {
  return parsePaperRead(extractJson(text));
}

/** Same wood name → one editor section. First non-empty rate wins; empty → 4000. */
export function sectionsFromPaperLines(lines: PaperLine[]): Section[] {
  const map = new Map<string, Section>();
  for (const line of lines) {
    if (!line.keep || !paperLineHasSize(line)) continue;
    const name = line.name.trim() || "Teak";
    const key = name.toLowerCase();
    let sec = map.get(key);
    if (!sec) {
      sec = { name, rate: line.rate.trim(), rows: [] };
      map.set(key, sec);
    } else if (!String(sec.rate || "").trim() && line.rate.trim()) {
      sec.rate = line.rate.trim();
    }
    sec.rows.push({ l: line.l, w: line.w, t: line.t, pcs: line.pcs });
  }
  const out = [...map.values()];
  for (const sec of out) {
    if (!String(sec.rate || "").trim()) sec.rate = 4000;
  }
  if (!out.length) return [{ name: "Teak", rate: 4000, rows: [{ l: "", w: "", t: "", pcs: "" }] }];
  return out;
}

export function paperQuoteSeed(opts: {
  lines: PaperLine[];
  customerName: string;
  paperPhoto: string;
}): Partial<Doc> {
  return {
    customerName: opts.customerName.trim(),
    notes: "From paper",
    sections: sectionsFromPaperLines(opts.lines),
    paperPhoto: opts.paperPhoto,
    status: "Draft",
  };
}
