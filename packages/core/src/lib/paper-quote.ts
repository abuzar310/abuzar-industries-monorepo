import { isGeminiBusy } from "./ai-host";
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

/** What a read hands to the quotation. */
export type PaperApply = {
  lines: PaperLine[];
  customerName: string;
  paperPhoto: string;
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

function rowHasSize(r: { l?: unknown; w?: unknown; t?: unknown; pcs?: unknown }): boolean {
  return [r.l, r.w, r.t, r.pcs].some((x) => String(x ?? "").trim() !== "");
}

/** Append paper woods onto an already-open quote. Empty starter rows drop. */
export function mergePaperSections(existing: Section[], incoming: Section[]): Section[] {
  const out: Section[] = existing.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r })) }));
  for (const add of incoming) {
    const i = out.findIndex((s) => s.name.trim().toLowerCase() === add.name.trim().toLowerCase());
    if (i < 0) {
      out.push({ name: add.name, rate: add.rate, rows: add.rows.map((r) => ({ ...r })) });
      continue;
    }
    const kept = out[i].rows.filter(rowHasSize);
    out[i] = {
      ...out[i],
      rows: [...kept, ...add.rows.map((r) => ({ ...r }))],
      rate: String(out[i].rate ?? "").trim() !== "" ? out[i].rate : add.rate,
    };
  }
  const useful = out.filter((s) => s.rows.some(rowHasSize));
  return useful.length ? useful : incoming.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r })) }));
}

/** Same quote, plus the paper lines. Does not invent a new quotation. */
export function applyPaperToDoc(
  doc: Doc,
  opts: { lines: PaperLine[]; customerName: string; paperPhoto: string },
): Doc {
  return {
    ...doc,
    customerName: String(doc.customerName || "").trim() || opts.customerName.trim(),
    paperPhoto: opts.paperPhoto || doc.paperPhoto,
    sections: mergePaperSections(doc.sections || [], sectionsFromPaperLines(opts.lines)),
  };
}

/** Toast after paper lines land on a quotation. */
export function paperAddedMessage(lines: PaperLine[]): string {
  const n = lines.filter((l) => l.keep && paperLineHasSize(l)).length;
  return n + (n === 1 ? " line" : " lines") + " added from paper. Check the sizes.";
}

export type PaperReadStep = { model: string; key: string };
export type PaperStepReply = { status: number; text?: string; message?: string };
export type PaperStepsResult = { read: PaperRead; step: PaperReadStep } | { error: string; busy: boolean };

export const PAPER_BUSY_MESSAGE = "Google's list reader is busy right now. Wait a minute, then tap Try again.";
const PAPER_STEP_MAX_MS = 30_000;
const PAPER_STEP_MIN_MS = 8_000;

/**
 * Try each model/key step until one reads sizes. Busy, out of quota, timeouts and cut-off replies move on;
 * a clear "no sizes" answer stops. A step never starts with less than 8 seconds of the budget left.
 */
export async function readPaperSteps(
  steps: PaperReadStep[],
  run: (step: PaperReadStep, timeoutMs: number) => Promise<PaperStepReply>,
  opts: { budgetMs: number; now?: () => number },
): Promise<PaperStepsResult> {
  const now = opts.now ?? Date.now;
  const start = now();
  let busy = false;
  let lastErr = "";
  for (const step of steps) {
    const left = opts.budgetMs - (now() - start);
    if (left < PAPER_STEP_MIN_MS) break;
    let reply: PaperStepReply;
    try {
      reply = await run(step, Math.min(left, PAPER_STEP_MAX_MS));
    } catch (e) {
      reply = { status: 0, message: e instanceof Error ? e.message : "Request failed" };
    }
    if (reply.status !== 200) {
      if (isGeminiBusy(reply.status)) busy = true;
      lastErr = reply.message || "AI error " + reply.status;
      continue;
    }
    let read: PaperRead;
    try {
      read = parsePaperAiJson(reply.text || "");
    } catch {
      lastErr = "Could not read that list — try a clearer photo";
      continue;
    }
    if (!read.lines.length) return { error: "No sizes found on that photo", busy: false };
    return { read, step };
  }
  if (busy) return { error: PAPER_BUSY_MESSAGE, busy: true };
  return { error: lastErr || "Could not read that list — try a clearer photo", busy: false };
}
