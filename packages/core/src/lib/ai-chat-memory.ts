// In-memory AI threads — one conversation per screen/document.
// Never written to localStorage (shared yard tablets) and never mixed across tabs.

export type AiMemMsg = { role: "user" | "assistant"; content: string; waPhone?: string };

const threads = new Map<string, AiMemMsg[]>();
let boundUser = "";

/** Isolate FAB vs full AI page, and isolate each tab / open quote / customer. */
export function aiChatKey(opts: {
  surface: "fab" | "page";
  pathname: string;
  docId?: string | null;
  customerId?: string | null;
}): string {
  const path = (opts.pathname || "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (opts.surface === "page") return "page:ai";
  if (opts.docId) return "fab:editor:" + opts.docId;
  if (opts.customerId) return "fab:customer:" + opts.customerId;
  if (path.startsWith("/editor")) return "fab:editor:hub";
  return "fab:" + path;
}

export function loadAiThread(key: string): AiMemMsg[] {
  const t = threads.get(key);
  return t ? t.map((m) => ({ ...m })) : [];
}

export function saveAiThread(key: string, messages: AiMemMsg[]) {
  if (!key) return;
  if (!messages.length) threads.delete(key);
  else threads.set(key, messages.map((m) => ({ ...m })));
}

export function clearAiThread(key: string) {
  threads.delete(key);
}

/** Drop every thread when the signed-in user changes (shared device). */
export function bindAiMemoryUser(userId: string | undefined) {
  const id = userId || "";
  if (id !== boundUser) {
    threads.clear();
    boundUser = id;
  }
}
