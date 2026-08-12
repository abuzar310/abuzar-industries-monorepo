"use client";
// Floating yard-chat button — same small favicon treatment as the AI assistant.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "@/store/useApp";
import { listChat, markChatRead, refreshChatUnseen, sendChat } from "@/lib/staff-chat";

export default function ChatFab() {
  const { ready, user, dataVersion, chatUnseen } = useApp();
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const onChatPage = pathname === "/chat" || pathname.startsWith("/chat/");
  const onAiPage = pathname === "/ai" || pathname.startsWith("/ai/");
  const msgs = ready ? listChat() : [];

  useEffect(() => {
    if (!open) return;
    markChatRead();
  }, [open, dataVersion, user?.id]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, msgs.length, dataVersion]);

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      await sendChat(text);
      setText("");
      refreshChatUnseen();
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !user || onChatPage) return null;

  return (
    <div className={"chat-fab-root no-print" + (onAiPage ? " low" : "")}>
      {open ? (
        <div className="ai-fab-panel" role="dialog" aria-label="Yard chat">
          <header className="ai-fab-panel-head">
            <div className="ai-fab-panel-titles">
              <strong>Yard chat</strong>
              <span className="ai-fab-ctx">
                {user.role === "owner" ? "You ↔ Manager" : "You ↔ Owner"}. Stays in this app.
              </span>
            </div>
            <button type="button" className="ai-fab-x" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </header>
          <div className="ai-fab-thread">
            {msgs.length === 0 ? (
              <p className="ai-fab-hint">No messages yet. Send a day update, a due, or a question.</p>
            ) : (
              msgs.map((m) => {
                const mine = m.fromId === user.id;
                return (
                  <div key={m.id} className={"ai-fab-msg" + (mine ? " ai-fab-msg--user" : " ai-fab-msg--assistant")}>
                    <div className="ai-fab-msg-body">
                      <span className="chat-fab-who">{mine ? "You" : m.fromName || m.fromRole}</span>
                      {m.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endRef} />
          </div>
          <form
            className="ai-fab-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              className="ai-fab-input"
              placeholder={user.role === "owner" ? "Message the manager…" : "Message the owner…"}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn primary sm" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        </div>
      ) : null}

      <div className="chat-fab-wrap">
        <button
          type="button"
          className={"ai-fab" + (open ? " on" : "")}
          onClick={() => setOpen((v) => !v)}
          title="Yard chat"
          aria-label="Open yard chat"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={40} height={40} />
        </button>
        {chatUnseen > 0 && !open ? <span className="chat-fab-badge">{chatUnseen > 9 ? "9+" : chatUnseen}</span> : null}
      </div>
    </div>
  );
}
