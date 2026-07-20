// GET /api/gst?gstin=... — GSTIN lookup proxy. Logic is shared in core.
import { handleGstLookup } from "@/lib/gst-server";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleGstLookup(req);
}
