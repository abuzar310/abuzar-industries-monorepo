// Server-only AI chat proxy. Key stays on the server (never to the browser).
// Official OpenAI Chat Completions only — no Gemini.
import { readSessionToken, SESSION_COOKIE } from "@/server/auth";
import { metaGetAll, metaSet, type AppSchema } from "@/server/db";

export type AiChatMessage = { role: "user" | "assistant" | "system"; content: string };

const OPENAI_HOST = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

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

function trimHost(h: string) {
  return h.trim().replace(/\/+$/, "");
}

function openaiHost(raw: string) {
  const h = trimHost(raw);
  if (!h || /googleapis\.com|generativelanguage|aistudio|gemini/i.test(h)) return OPENAI_HOST;
  return h;
}

async function aiCreds(schema: AppSchema) {
  const meta = await metaGetAll(schema);
  const key = String(meta.aiApiKey || process.env.AI_API_KEY || "").trim();
  const host = openaiHost(String(meta.aiHost || process.env.AI_BASE_URL || ""));
  const model = (process.env.AI_MODEL || "").trim() || DEFAULT_MODEL;
  return { key, host, model };
}

function systemPrompt(appLabel: string, schema: AppSchema): string {
  const unofficial = schema === "unofficial";
  return [
    "You are a helpful yard assistant for " + appLabel + " (Abuzar Industries timber business, Chitradurga).",
    "Help with quotations, customers, payments, suppliers, WhatsApp message drafts, and plain-language explanations.",
    "Be concise. Prefer short WhatsApp-ready drafts when asked to write a message.",
    "This app is NOT Tally/Zoho/Vyapar.",
    unofficial
      ? "Cut Size tabs: Dashboard, Balances, Receipts, Accounts, Quotation editor, Quotations, Customers, Carpenters, Suppliers/Buys, Contacts, Daybook, Books, Logs, Attendance. Quote payments: editor Payment / Accept payment (Cash/UPI) or Receipts."
      : "Official tabs: Dashboard, Quotation, Quotations, Invoices, Customers, Suppliers, Stock, Reports. Quotations are estimates; invoices are the bills. Stock moves on buy/sell invoices.",
    "You have a READ-ONLY database snapshot in this request. You cannot record payments, edit quotes, or change stock.",
    "Never invent GST numbers, bank balances, or payment amounts — use only the READ-ONLY snapshot or figures the user typed.",
    "If the snapshot lists dues, answer who-owes questions from it. Do not say you lack access.",
    "Do not claim you changed the books; you only advise and draft.",
  ].join(" ");
}

function upstreamErrorMessage(data: unknown, status: number): string {
  if (!data || typeof data !== "object") return "AI error " + status;
  const d = data as {
    error?: { message?: string; status?: string } | string;
    message?: string;
  };
  if (typeof d.error === "string" && d.error.trim()) return d.error;
  if (typeof d.error === "object" && d.error?.message) return d.error.message;
  if (typeof d.message === "string" && d.message.trim()) return d.message;
  return "AI error " + status;
}

/** GET/PUT /api/ai/config — owner sets OpenAI key in Settings. Key never returned. */
export async function handleAiConfig(req: Request, schema: AppSchema): Promise<Response> {
  const user = sessionUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  if (req.method === "GET") {
    const c = await aiCreds(schema);
    return json({ host: c.host, configured: !!c.key, provider: "openai" });
  }

  if (req.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  if (user.role !== "owner") return json({ error: "Owner only" }, 403);

  let body: { host?: string; apiKey?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  await metaSet(schema, "aiHost", OPENAI_HOST);
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    await metaSet(schema, "aiApiKey", body.apiKey.trim().slice(0, 600));
  }

  const c = await aiCreds(schema);
  return json({ ok: true, host: c.host, configured: !!c.key, provider: "openai" });
}

/** POST /api/ai/chat — { messages, pathname?, docId?, cloak? }  Read-only DB snapshot; never writes. */
export async function handleAiChat(req: Request, appLabel: string, schema: AppSchema): Promise<Response> {
  const user = sessionUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const { key, host, model } = await aiCreds(schema);
  if (!key) return json({ error: "Add the OpenAI API key in Settings" }, 503);

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
    const { readAiDbSnapshot } = await import("@/lib/ai-db-read");
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
  const abort =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(60000) : undefined;

  try {
    const url = /\/chat\/completions$/i.test(host) ? host : host + "/chat/completions";
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: sys }, ...cleaned],
        max_tokens: 1200,
        temperature: 0.5,
      }),
      signal: abort,
    });
    const data = (await upstream.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string } | string;
      message?: string;
    } | null;
    if (!upstream.ok) {
      return json({ error: upstreamErrorMessage(data, upstream.status).slice(0, 400) }, 502);
    }
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    if (!text) return json({ error: "Empty reply from OpenAI" }, 502);
    return json({ reply: text, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI request failed";
    return json({ error: msg.slice(0, 400) }, 502);
  }
}
