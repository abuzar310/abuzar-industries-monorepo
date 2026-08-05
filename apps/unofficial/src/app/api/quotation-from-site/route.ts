// Public ingest: landing QuoteTool → unofficial.website_quotations.
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
const MAX_ROWS = 40;
const MAX_NAME = 80;
const MAX_PHONE = 24;
const MAX_WOOD = 60;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
}

function cftOf(l: number, w: number, t: number, pcs: number) {
  return Math.round(((l * w * t * pcs) / 144) * 100) / 100;
}

function uid() {
  return (
    "WQ-" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
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
    return json({ ok: true, id: "ok" }); // fake success
  }

  const customerName = String(body.name || body.customerName || "").trim().slice(0, MAX_NAME);
  const phone = String(body.phone || "").trim().slice(0, MAX_PHONE);
  const woodType = String(body.woodType || body.wood || "").trim().slice(0, MAX_WOOD);

  if (!customerName) return json({ error: "Name is required" }, 400);
  if (!woodType) return json({ error: "Wood type is required" }, 400);

  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (!rawRows.length) return json({ error: "At least one dimension row is required" }, 400);
  if (rawRows.length > MAX_ROWS) return json({ error: "Too many rows" }, 400);

  const rows: { l: number; w: number; t: number; pcs: number; cft: number }[] = [];
  for (const r of rawRows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const l = num(o.l);
    const w = num(o.w);
    const t = num(o.t);
    const pcs = Math.max(1, Math.round(num(o.pcs) || 1));
    if (!(l > 0 && w > 0 && t > 0 && pcs > 0)) continue;
    if (l > 100 || w > 100 || t > 100 || pcs > 10_000) {
      return json({ error: "Dimension out of range" }, 400);
    }
    rows.push({ l, w, t, pcs, cft: cftOf(l, w, t, pcs) });
  }
  if (!rows.length) return json({ error: "Enter valid L × W × T dimensions" }, 400);

  const totalCft = Math.round(rows.reduce((s, r) => s + r.cft, 0) * 100) / 100;
  const estimate = Math.round(totalCft * EST_RATE);
  const now = new Date().toISOString();
  const id = uid();

  const data = {
    id,
    source: "website" as const,
    status: "Pending" as const,
    customerName,
    phone,
    woodType,
    rows,
    totalCft,
    estimate,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await upsertRow("unofficial", "website_quotations", id, data);
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
  });
}
