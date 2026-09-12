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

export function blankPaperLine(): PaperLine {
  return { keep: true, name: "Teak", l: "", w: "", t: "", pcs: "", rate: "" };
}

export function paperLineHasSize(line: PaperLine): boolean {
  return [line.l, line.w, line.t, line.pcs].some((x) => String(x ?? "").trim() !== "");
}

function cell(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
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

export function parsePaperRead(raw: unknown): PaperRead {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(o.lines) ? o.lines : [];
  const lines: PaperLine[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const line: PaperLine = {
      keep: r.keep === false ? false : true,
      name: cell(r.name) || "Teak",
      l: cell(r.l),
      w: cell(r.w),
      t: cell(r.t),
      pcs: cell(r.pcs),
      rate: cell(r.rate),
    };
    if (!paperLineHasSize(line)) continue;
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
