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

export function normalizeAiModel(raw: string): string {
  const m = raw.trim().slice(0, 80);
  return m || DEFAULT_AI_MODEL;
}
