import { handleAiReadPaper } from "@/lib/ai-server";

export const dynamic = "force-dynamic";
// A photo read takes 10 to 30 seconds, and a busy model gets another try.
export const maxDuration = 60;

export function POST(req: Request) {
  return handleAiReadPaper(req, "merged");
}
