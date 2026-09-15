"use client";
// Full-page AI conversation — its own thread, never mixed with the floating button.
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/store/useApp";
import { getFeatures } from "@/lib/features";
import { isCloaked } from "@/lib/cloak";
import { TabIcon } from "@/components/Icons";
import {
  aiChatKey,
  bindAiMemoryUser,
  clearAiThread,
  loadAiThread,
  saveAiThread,
  type AiMemMsg,
} from "@/lib/ai-chat-memory";

type Msg = AiMemMsg;

function starters() {
  if (getFeatures().simpleQuote) {
    return [
      "Who owes us the most right now?",
      "Draft a polite WhatsApp reminder for a customer who owes ₹50,000",
      "In this Cut Size app, how do I record a part payment on a quotation (Cash/UPI)?",
      "Write a short thank-you + Google review request message",
    ];
  }
  return [
    "Who owes us the most on invoices?",
    "Draft a WhatsApp note sending tax invoice [number] to [Name]",
    "How do I convert a quotation into an invoice in this app?",
    "Write a short thank-you + Google review request message",
  ];
}

export default function AiChatView() {
  const { user } = useApp();
  const threadKey = aiChatKey({ surface: "page", pathname: "/ai" });
  const [messages, setMessages] = useState<Msg[]>(() => loadAiThread(threadKey));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bindAiMemoryUser(user?.id);
    setMessages(loadAiThread(threadKey));
  }, [user?.id, threadKey]);

  function commit(next: Msg[]) {
    setMessages(next);
    saveAiThread(threadKey, next);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setErr("");
    const next: Msg[] = [...messages, { role: "user", content: t }];
    commit(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          pathname: "/ai",
          cloak: isCloaked(),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!r.ok) throw new Error(data.error || "AI failed (" + r.status + ")");
      commit([...next, { role: "assistant", content: data.reply || "" }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI failed");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="ai-page ph-kit">
      <header className="ai-page-head">
        <div>
          <h1 className="ai-page-title"><span className="phone-ico ph-only"><TabIcon icon="chart" size={18} /></span>AI Assistant</h1>
          <p className="ai-page-sub">Draft WhatsApp messages, explain balances, ask how to use the yard books. This chat stays on the AI tab only.</p>
        </div>
        {messages.length > 0 ? (
          <button type="button" className="btn sm" onClick={() => { clearAiThread(threadKey); commit([]); setErr(""); }}>
            Clear chat
          </button>
        ) : null}
      </header>

      <div className="ai-thread">
        {messages.length === 0 ? (
          <div className="ai-empty">
            <p>Try one of these:</p>
            <div className="ai-starters">
              {starters().map((s) => (
                <button key={s} type="button" className="ai-starter" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={"ai-bubble ai-bubble--" + m.role}>
              <span className="ai-bubble-role">{m.role === "user" ? "You" : "Assistant"}</span>
              <div className="ai-bubble-body">{m.content}</div>
            </div>
          ))
        )}
        {busy ? (
          <div className="ai-bubble ai-bubble--assistant ai-bubble--busy">
            <span className="ai-bubble-role">Assistant</span>
            <div className="ai-bubble-body">Thinking…</div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {err ? <p className="ai-err">{err}</p> : null}

      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={inputRef}
          className="ai-input"
          rows={2}
          placeholder="Ask anything about quotations, payments, suppliers…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
