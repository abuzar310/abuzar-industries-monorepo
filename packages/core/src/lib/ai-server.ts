// Server-only AI chat proxy. Key stays on the server (never to the browser).
// Default: Google Gemini (AI Studio) via native generateContent API.
import { readSessionToken, SESSION_COOKIE } from "@/server/auth";
import type { AppSchema } from "@/server/db";
import { readAiDbSnapshot } from "@/lib/ai-db-read";

export type AiChatMessage = { role: "user" | "assistant" | "system"; content: string };

const DEFAULT_MODEL = "gemini-flash-latest";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function sessionUser(req: Request) {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([^;]+)"));
  const token = m?.[1] ? decodeURIComponent(m[1]) : undefined;
  return readSessionToken(token);
}

function systemPrompt(appLabel: string, schema: AppSchema): string {
  const unofficial = schema === "unofficial";
  return [
    "You are a helpful yard assistant for " + appLabel + " (Abuzar Industries timber business, Chitradurga).",
    "Help with quotations, customers, payments, suppliers, WhatsApp message drafts, and plain-language explanations.",
    "Be concise. Prefer short WhatsApp-ready drafts when asked to write a message.",
    "This app is NOT Tally/Zoho/Vyapar.",
    unofficial
      ? "Cut Size tabs: Dashboard, Balances (who owes), Receipts, Accounts, Quotation editor, Quotations, Customers, Suppliers/Buys, Contacts, Daybook, Books, Logs, Attendance. Quote payments: editor Payment / Accept payment (Cash/UPI) or Receipts."
      : "Official tabs: Dashboard, Quotation, Quotations, Invoices, Customers, Suppliers, Stock, Reports. Quotations are estimates; invoices are the bills. Stock moves on buy/sell invoices.",
    "You have a READ-ONLY database snapshot in this request. You cannot record payments, edit quotes, or change stock.",
    "Never invent GST numbers, bank balances, or payment amounts — use only the READ-ONLY snapshot or figures the user typed.",
    "If the snapshot lists dues, answer who-owes questions from it. Do not say you lack access.",
    "Do not claim you changed the books; you only advise and draft.",
  ].join(" ");
}

function upstreamErrorMessage(data: unknown, status: number): string {
  if (!data || typeof data !== "object") return "Gemini error " + status;
  const d = data as {
    error?: { message?: string; status?: string } | string;
    message?: string;
  };
  if (typeof d.error === "string" && d.error.trim()) return d.error;
  if (typeof d.error === "object" && d.error?.message) return d.error.message;
  if (typeof d.message === "string" && d.message.trim()) return d.message;
  return "Gemini error " + status;
}

/** Map chat turns to Gemini contents (system goes in systemInstruction). */
function toGeminiContents(messages: AiChatMessage[]) {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += "\n\n" + m.content;
    } else {
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }
  // Gemini requires the last turn to be from the user
  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return null;
  }
  return contents;
}

/** POST /api/ai/chat — { messages, pathname?, docId?, cloak? }  Read-only DB snapshot; never writes. */
export async function handleAiChat(req: Request, appLabel: string, schema: AppSchema): Promise<Response> {
  const user = sessionUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const key = (process.env.AI_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.AI_MODEL || DEFAULT_MODEL).trim().replace(/^models\//, "");
  if (!key) return json({ error: "AI_API_KEY is not configured on the server" }, 503);

  let body: {
    messages?: AiChatMessage[];
    pathname?: string;
    docId?: string;
    cloak?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const cleaned = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 4000) }))
    .slice(-20);

  if (!cleaned.length || cleaned[cleaned.length - 1].role !== "user") {
    return json({ error: "Send at least one user message" }, 400);
  }

  const lastUser = cleaned[cleaned.length - 1].content;
  let snapshot = "";
  try {
    snapshot = await readAiDbSnapshot({
      schema,
      pathname: typeof body.pathname === "string" ? body.pathname.slice(0, 200) : "/",
      docId: typeof body.docId === "string" ? body.docId.slice(0, 80) : "",
      question: lastUser,
      cloak: !!body.cloak,
    });
  } catch {
    snapshot = "READ-ONLY DB snapshot failed. Do not invent amounts.";
  }

  const label = appLabel + (schema === "unofficial" ? " · Cut Size" : " · Official");
  const sys = systemPrompt(label, schema) + (snapshot ? "\n\n" + snapshot : "");
  const contents = toGeminiContents(cleaned);
  if (!contents) return json({ error: "Send at least one user message" }, 400);

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(key);

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: {
          maxOutputTokens: 600,
          temperature: 0.5,
        },
      }),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(60000) : undefined,
    });

    const data = (await upstream.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string } | string;
      message?: string;
    } | null;

    if (!upstream.ok) {
      return json({ error: upstreamErrorMessage(data, upstream.status).slice(0, 400) }, 502);
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!text) return json({ error: "Empty reply from Gemini" }, 502);
    return json({ reply: text, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI request failed";
    return json({ error: msg.slice(0, 400) }, 502);
  }
}
