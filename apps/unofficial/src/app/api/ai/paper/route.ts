import { handleAiReadPaper } from "@/lib/ai-server";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleAiReadPaper(req, "unofficial");
}
