// Public ingest: landing QuoteTool + /calculator → merged.website_quotations.
// No login. Honeypot + per-IP rate limit. CFT recomputed server-side.
import { NextRequest, NextResponse } from "next/server";
import { upsertRow } from "@/server/db";
import { rateLimitByIp, rateLimitResponse } from "@/server/rate-limit";

export const runtime = "nodejs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const EST_RATE = 2600;
const MAX_ROWS = 80;
const MAX_SECTIONS = 12;
const MAX_NAME = 80;
const MAX_PHONE = 24;
const MAX_WOOD = 60;

type QuoteRow = { l: number; w: number; t: number; pcs: number; cft: number };
type QuoteSec = { woodType: string; rate: number; rows: QuoteRow[]; totalCft: number };

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
}

function cftOf(l: number, w: number, t: number, pcs: number) {
  return Math.round(((l * w * t * pcs) / 144) * 100) / 100;
}

function uid() {
  return "WQ-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseRows(raw: unknown): QuoteRow[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "At least one dimension row is required" };
  if (raw.length > MAX_ROWS) return { error: "Too many rows" };
  const rows: QuoteRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const l = num(o.l);
    const w = num(o.w);
    const t = num(o.t);
    const pcs = Math.max(1, Math.round(num(o.pcs) || 1));
    if (!(l > 0 && w > 0 && t > 0 && pcs > 0)) continue;
    if (l > 100 || w > 100 || t > 100 || pcs > 10_000) {
      return { error: "Dimension out of range" };
    }
    rows.push({ l, w, t, pcs, cft: cftOf(l, w, t, pcs) });
  }
  if (!rows.length) return { error: "Enter valid L × W × T dimensions" };
  return rows;
}

export async function POST(req: NextRequest) {
  const lim = rateLimitByIp(req, 8, 60_000);
  if (!lim.ok) {
    const r = rateLimitResponse(lim.resetIn);
    Object.entries(CORS).forEach(([k, v]) => r.headers.set(k, v));
    return r;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Honeypot — bots fill hidden fields; humans never see them.
  if (String(body.website || body.company || body.hp || "").trim()) {
    return json({ ok: true, id: "ok" });
  }

  const customerName = String(body.name || body.customerName || "").trim().slice(0, MAX_NAME);
  const phone = String(body.phone || "").trim().slice(0, MAX_PHONE);
  if (!customerName) return json({ error: "Name is required" }, 400);

  const sections: QuoteSec[] = [];

  // Multi-wood calculator payload: { sections: [{ woodType, rate, rows }] }
  if (Array.isArray(body.sections) && body.sections.length) {
    if (body.sections.length > MAX_SECTIONS) return json({ error: "Too many wood types" }, 400);
    for (const raw of body.sections) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const woodType = String(o.woodType || o.wood || o.name || "").trim().slice(0, MAX_WOOD);
      if (!woodType) continue;
      const parsed = parseRows(o.rows);
      if ("error" in parsed) continue;
      const totalCft = Math.round(parsed.reduce((s, r) => s + r.cft, 0) * 100) / 100;
      const rate = Math.max(0, num(o.rate) || 0);
      sections.push({ woodType, rate, rows: parsed, totalCft });
    }
  } else {
    // Legacy homepage QuoteTool: { woodType, rows }
    const woodType = String(body.woodType || body.wood || "").trim().slice(0, MAX_WOOD);
    if (!woodType) return json({ error: "Wood type is required" }, 400);
    const parsed = parseRows(body.rows);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    const totalCft = Math.round(parsed.reduce((s, r) => s + r.cft, 0) * 100) / 100;
    sections.push({ woodType, rate: 0, rows: parsed, totalCft });
  }

  if (!sections.length) return json({ error: "Enter valid L × W × T dimensions" }, 400);

  const totalCft = Math.round(sections.reduce((s, sec) => s + sec.totalCft, 0) * 100) / 100;
  // Prefer client-priced estimate when rates exist; else flat EST_RATE
  const priced = sections.reduce((s, sec) => s + Math.round(sec.totalCft * (sec.rate || 0)), 0);
  const estimate = priced > 0 ? priced : Math.round(totalCft * EST_RATE);
  const now = new Date().toISOString();
  const id = uid();

  // Flat fields kept for list UI / older rows (first wood + all rows)
  const woodType = sections.map((s) => s.woodType).join(" · ");
  const rows = sections.flatMap((s) => s.rows);

  const data = {
    id,
    source: "website" as const,
    status: "Pending" as const,
    customerName,
    phone,
    woodType,
    rows,
    sections,
    totalCft,
    estimate,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await upsertRow("merged", "website_quotations", id, data);
  } catch (e) {
    console.error("quotation-from-site upsert failed", e);
    return json({ error: "Could not save quotation" }, 500);
  }

  return json({
    ok: true,
    id,
    cft: totalCft,
    estimate,
    count: rows.length,
    woods: sections.length,
  });
}
