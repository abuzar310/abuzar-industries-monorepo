// Server-only AI chat proxy. Key stays on the server (never to the browser).
// OpenAI-compatible Chat Completions (OpenAI, Groq, OpenRouter, local, …).
import { readSessionToken, SESSION_COOKIE } from "@/server/auth";
import { metaGetAll, metaSet, type AppSchema } from "@/server/db";
import {
  chatCompletionsUrl,
  DEFAULT_AI_HOST,
  DEFAULT_GEMINI_MODEL,
  geminiGenerateUrl,
  geminiPaperModel,
  geminiPaperPlan,
  isGemini,
  isGeminiKey,
  isKintio,
  kintioMessagesUrl,
  normalizeAiHost,
  normalizeAiModel,
  textFromAnthropicSse,
  textFromGemini,
} from "@/lib/ai-host";
import { PAPER_READ_PROMPT, parsePaperAiJson, readPaperSteps } from "@/lib/paper-quote";

export type AiChatMessage = { role: "user" | "assistant" | "system"; content: string };

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

async function aiCreds(schema: AppSchema) {
  const meta = await metaGetAll(schema);
  const key = String(meta.aiApiKey || process.env.AI_API_KEY || "").trim();
  const host = normalizeAiHost(String(meta.aiHost || process.env.AI_BASE_URL || "")) || DEFAULT_AI_HOST;
  const model = normalizeAiModel(String(meta.aiModel || process.env.AI_MODEL || ""));
  return { key, host, model };
}

/** Settings still has gpt-4o-mini; Kintio's list does not. Paper uses their router. */
function kintioPaperModel(model: string): string {
  const m = model.trim();
  if (!m || /^gpt-4o/i.test(m)) return "kintio-auto";
  return m;
}

/** Paper prefers Gemini so Kintio chat can stay in Settings. Tries each key. */
function geminiPaperKeys(settings: { key: string; host: string; model: string }) {
  const keys: string[] = [];
  const add = (raw: string) => {
    const s = String(raw || "").trim();
    if (isGeminiKey(s) && !keys.includes(s)) keys.push(s);
  };
  add(settings.key);
  add(process.env.GEMINI_API_KEY || "");
  add(process.env.GEMINI_API_KEY_2 || "");
  add(process.env.AI_API_KEY || "");
  if (!keys.length) return null;
  const model = isGemini(settings.host, settings.key) ? geminiPaperModel(settings.model) : DEFAULT_GEMINI_MODEL;
  return { keys, model };
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

/** GET/PUT /api/ai/config — owner sets key + host in Settings. Key never returned. */
export async function handleAiConfig(req: Request, schema: AppSchema): Promise<Response> {
  const user = sessionUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  if (req.method === "GET") {
    const c = await aiCreds(schema);
    return json({ host: c.host, model: c.model, configured: !!c.key });
  }

  if (req.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  if (user.role !== "owner") return json({ error: "Owner only" }, 403);

  let body: { host?: string; apiKey?: string; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (typeof body.host === "string") {
    const host = normalizeAiHost(body.host);
    if (!host) return json({ error: "Enter a valid http(s) host URL" }, 400);
    await metaSet(schema, "aiHost", host.slice(0, 300));
  }
  if (typeof body.model === "string" && body.model.trim()) {
    await metaSet(schema, "aiModel", normalizeAiModel(body.model));
  }
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    await metaSet(schema, "aiApiKey", body.apiKey.trim().slice(0, 600));
  }

  const c = await aiCreds(schema);
  return json({ ok: true, host: c.host, model: c.model, configured: !!c.key });
}

/** POST /api/ai/chat — { messages, pathname?, docId?, cloak? }  Read-only DB snapshot; never writes. */
export async function handleAiChat(req: Request, appLabel: string, schema: AppSchema): Promise<Response> {
  const user = sessionUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const { key, host, model } = await aiCreds(schema);
  if (!key) return json({ error: "Add an API key in Settings → AI assistant" }, 503);

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
    if (isKintio(host, key)) {
      const upstream = await fetch(kintioMessagesUrl(host), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          stream: true,
          system: sys,
          messages: cleaned,
        }),
        signal: abort,
      });
      const raw = await upstream.text();
      if (!upstream.ok) {
        let data: unknown = null;
        try {
          data = JSON.parse(raw);
        } catch {
          data = { message: raw.slice(0, 200) };
        }
        return json({ error: upstreamErrorMessage(data, upstream.status).slice(0, 400) }, 502);
      }
      const text = textFromAnthropicSse(raw).trim();
      if (!text) return json({ error: "Empty reply from the AI host" }, 502);
      return json({ reply: text, model });
    }

    const url = chatCompletionsUrl(host);
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
    if (!text) return json({ error: "Empty reply from the AI host" }, 502);
    return json({ reply: text, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI request failed";
    return json({ error: msg.slice(0, 400) }, 502);
  }
}

const PAPER_MAX_CHARS = 500_000;
// The route gets 60 seconds on Vercel. Stop starting new tries with time left to answer.
const PAPER_BUDGET_MS = 50_000;

function paperImageParts(image: string) {
  const m = image.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!m) return null;
  const media = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  return { media, data: m[2] };
}

function textFromKintioBody(raw: string): string {
  const sse = textFromAnthropicSse(raw).trim();
  if (sse) return sse;
  try {
    const d = JSON.parse(raw) as { content?: { text?: string }[] };
    const t = (d.content || []).map((c) => c.text || "").join("").trim();
    if (t) return t;
  } catch {
    /* not json */
  }
  return raw.trim();
}

/** POST /api/ai/paper — { image: dataUrl }. Reads sizes. Never writes a quotation. */
export async function handleAiReadPaper(req: Request, schema: AppSchema): Promise<Response> {
  const user = sessionUser(req);
  if (!user) return json({ error: "Sign in first" }, 401);

  const creds = await aiCreds(schema);
  const gemini = geminiPaperKeys(creds);
  let { key, host, model } = creds;
  if (isKintio(host, key)) model = kintioPaperModel(model);
  if (!key && !gemini) return json({ error: "Add an API key in Settings → AI assistant" }, 503);

  let body: { image?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const image = String(body.image || "").trim();
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
    return json({ error: "Send a JPEG or PNG photo" }, 400);
  }
  if (image.length > PAPER_MAX_CHARS) return json({ error: "Photo is too large — try another shot" }, 400);

  const abort =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(60000) : undefined;

  try {
    let text = "";
    if (gemini) {
      const parts = paperImageParts(image);
      if (!parts) return json({ error: "Send a JPEG or PNG photo" }, 400);
      // Thinking stays on: without it the model reads their handwritten 2 as 4 or 11.
      // 8192 tokens leave room for the thinking plus a long list.
      const payload = JSON.stringify({
        systemInstruction: { parts: [{ text: "Return JSON only. No markdown." }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: parts.media, data: parts.data } },
              { text: PAPER_READ_PROMPT },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json" },
      });
      const got = await readPaperSteps(
        geminiPaperPlan(gemini.model, gemini.keys),
        async (step, timeoutMs) => {
          const upstream = await fetch(geminiGenerateUrl(step.model, step.key), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: AbortSignal.timeout(timeoutMs),
          });
          const data = (await upstream.json().catch(() => null)) as unknown;
          if (!upstream.ok) {
            return { status: upstream.status, message: upstreamErrorMessage(data, upstream.status).slice(0, 400) };
          }
          return { status: 200, text: textFromGemini(data) };
        },
        { budgetMs: PAPER_BUDGET_MS },
      );
      if ("error" in got) {
        const status = got.busy ? 503 : /No sizes/.test(got.error) ? 422 : 502;
        return json({ error: got.error, busy: got.busy }, status);
      }
      return json(got.read);
    } else if (isKintio(host, key)) {
      const parts = paperImageParts(image);
      if (!parts) return json({ error: "Send a JPEG or PNG photo" }, 400);
      const upstream = await fetch(kintioMessagesUrl(host), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          stream: true,
          system: "Return JSON only. No markdown.",
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: parts.media, data: parts.data } },
                { type: "text", text: PAPER_READ_PROMPT },
              ],
            },
          ],
        }),
        signal: abort,
      });
      const raw = await upstream.text();
      if (!upstream.ok) {
        let data: unknown = null;
        try {
          data = JSON.parse(raw);
        } catch {
          data = { message: raw.slice(0, 200) };
        }
        const msg = upstreamErrorMessage(data, upstream.status);
        if (upstream.status === 402 || /upgrade_required/i.test(msg)) {
          return json({ error: "Kintio is blocking photos on this plan — open kintio.com and turn on vision" }, 502);
        }
        return json({ error: msg.slice(0, 400) }, 502);
      }
      text = textFromKintioBody(raw);
    } else {
      const url = chatCompletionsUrl(host);
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: PAPER_READ_PROMPT },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
          max_tokens: 2000,
          temperature: 0,
          response_format: { type: "json_object" },
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
      text = (data?.choices?.[0]?.message?.content || "").trim();
    }
    if (!text) return json({ error: "Could not read that list — try a clearer photo" }, 502);
    let parsed;
    try {
      parsed = parsePaperAiJson(text);
    } catch {
      return json({ error: "Could not read that list — try a clearer photo" }, 502);
    }
    if (!parsed.lines.length) return json({ error: "No sizes found on that photo" }, 422);
    return json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI request failed";
    return json({ error: msg.slice(0, 400) }, 502);
  }
}
