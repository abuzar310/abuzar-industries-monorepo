/** OpenAI-compatible Chat Completions host. Empty / invalid → default. */
export const DEFAULT_AI_HOST = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";

export function normalizeAiHost(raw: string): string | null {
  const h = raw.trim().replace(/\/+$/, "");
  if (!h) return DEFAULT_AI_HOST;
  let u: URL;
  try {
    u = new URL(h);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const path = u.pathname.replace(/\/+$/, "");
  return u.origin + path;
}

export function chatCompletionsUrl(host: string): string {
  const h = host.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(h) ? h : h + "/chat/completions";
}

/** Kintio (and sf_ keys) speak Anthropic /v1/messages, not OpenAI chat completions. */
export function isKintio(host: string, key = ""): boolean {
  if (key.trim().startsWith("sf_")) return true;
  try {
    return /(^|\.)kintio\.com$/i.test(new URL(host).hostname);
  } catch {
    return false;
  }
}

export function kintioMessagesUrl(host: string): string {
  const h = (isKintio(host) ? host : "https://api.kintio.com").replace(/\/+$/, "");
  if (/\/v1\/messages$/i.test(h)) return h;
  if (/\/v1$/i.test(h)) return h + "/messages";
  return h + "/v1/messages";
}

export function textFromAnthropicSse(raw: string): string {
  const bits: string[] = [];
  for (const line of raw.split(/\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const ev = JSON.parse(payload) as { delta?: { text?: string } };
      if (ev.delta?.text) bits.push(ev.delta.text);
    } catch {
      /* skip keep-alives */
    }
  }
  return bits.join("");
}

export function normalizeAiModel(raw: string): string {
  const m = raw.trim().slice(0, 80);
  return m || DEFAULT_AI_MODEL;
}

export const GEMINI_HOST = "https://generativelanguage.googleapis.com";
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export function isGemini(host: string, key = ""): boolean {
  if (key.trim().startsWith("AIza")) return true;
  try {
    return /generativelanguage\.googleapis\.com$/i.test(new URL(host).hostname);
  } catch {
    return false;
  }
}

export function geminiPaperModel(model: string): string {
  const m = model.trim().replace(/^models\//, "");
  if (/^gemini/i.test(m)) return m;
  return DEFAULT_GEMINI_MODEL;
}

export function geminiGenerateUrl(model: string, key: string): string {
  return (
    GEMINI_HOST +
    "/v1beta/models/" +
    encodeURIComponent(geminiPaperModel(model)) +
    ":generateContent?key=" +
    encodeURIComponent(key)
  );
}

export function textFromGemini(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const parts = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]
    ?.content?.parts;
  return (parts || []).map((p) => p.text || "").join("").trim();
}
