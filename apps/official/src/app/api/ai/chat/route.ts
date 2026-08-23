import { handleAiChat } from "@/lib/ai-server";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleAiChat(req, "Abuzar Industries", "official");
}
