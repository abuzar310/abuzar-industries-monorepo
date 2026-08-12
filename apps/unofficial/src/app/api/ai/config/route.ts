import { handleAiConfig } from "@/lib/ai-server";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleAiConfig(req, "unofficial");
}

export function PUT(req: Request) {
  return handleAiConfig(req, "unofficial");
}
