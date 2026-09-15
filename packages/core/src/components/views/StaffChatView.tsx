"use client";
// Owner <-> Manager chat. Synced through the same cloud store as the books (not WhatsApp).
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/store/useApp";
import { listChat, markChatRead, refreshChatUnseen, sendChat } from "@/lib/staff-chat";
import { USERS } from "@/lib/local-auth";

export default function StaffChatView() {
  const { ready, user, dataVersion } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const msgs = ready ? listChat() : [];
  const other = USERS.find((u) => u.id !== user?.id);

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("draft");
    if (!d) return;
    setText(d);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    markChatRead();
  }, [dataVersion, user?.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, dataVersion]);

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

  if (!ready || !user) return null;

  return (
    <div className="staff-chat ph-kit">
      <header className="staff-chat-head">
        <div>
          <h1 className="staff-chat-title">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="" width={28} height={28} className="staff-chat-mark" />
            Yard chat
          </h1>
          <p className="staff-chat-sub">
            {user.role === "owner" ? "You (Owner) ↔ Manager" : "You (Manager) ↔ Owner"}
            {other ? " · " + other.name : ""}. Stays in this app — not WhatsApp.
          </p>
        </div>
      </header>

      <div className="staff-chat-thread">
        {msgs.length === 0 ? (
          <p className="staff-chat-empty">No messages yet. Send a day update, a due, or a question.</p>
        ) : (
          msgs.map((m) => {
            const mine = m.fromId === user.id;
            return (
              <div key={m.id} className={"staff-chat-msg" + (mine ? " mine" : "")}>
                <span className="staff-chat-who">
                  {mine ? "You" : m.fromName || m.fromRole}
                  {m.createdAt ? " · " + m.createdAt.replace("T", " ").slice(0, 16) : ""}
                </span>
                <div className="staff-chat-body">{m.text}</div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form
        className="staff-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="staff-chat-input"
          rows={2}
          placeholder={user.role === "owner" ? "Message the manager…" : "Message the owner…"}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
