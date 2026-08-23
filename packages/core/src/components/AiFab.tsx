"use client";
// Floating AI button — page-aware predetermined commands + chat.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/store/useApp";
import { loadDoc } from "@/lib/doc";
import { useEditorTabs } from "@/lib/editor-tabs";
import { isCloaked } from "@/lib/cloak";
import { getCached, listCached } from "@/lib/data";
import { getFeatures } from "@/lib/features";
import { customerFinancials } from "@/lib/customers";
import { factsFromDoc, openWhatsApp, type AiQuickAction } from "@/lib/ai-doc-actions";
import { resolveAiPageActions } from "@/lib/ai-page-actions";
import { liveQuickActions, navIntentHref } from "@/lib/ai-live-context";
import {
  aiChatKey,
  bindAiMemoryUser,
  clearAiThread,
  loadAiThread,
  saveAiThread,
  type AiMemMsg,
} from "@/lib/ai-chat-memory";
import { balanceReminderMessage, customerFollowupMessage } from "@/lib/whatsapp";
import type { Customer, Doc, Expense } from "@/lib/types";

type Msg = AiMemMsg;

function editorDocId(pathname: string, activeId: string | null): string | null {
  const m = pathname.match(/^\/editor\/([^/]+)/);
  if (!m) return null;
  const fromUrl = decodeURIComponent(m[1]);
  if (activeId && !activeId.startsWith("temp_")) return activeId;
  if (fromUrl.startsWith("temp_")) return activeId && !activeId.startsWith("temp_") ? activeId : null;
  return fromUrl;
}

function customerIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/customers\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function AiFab() {
  const { ready, user, dataVersion } = useApp();
  const pathname = usePathname() || "";
  const router = useRouter();
  const { activeId } = useEditorTabs();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const threadKeyRef = useRef("");

  const onAiPage = pathname === "/ai" || pathname.startsWith("/ai/");
  const onChatPage = pathname === "/chat" || pathname.startsWith("/chat/");
  const docId = editorDocId(pathname, activeId);
  const custId = customerIdFromPath(pathname);
  const threadKey = aiChatKey({ surface: "fab", pathname, docId, customerId: custId });

  useEffect(() => {
    bindAiMemoryUser(user?.id);
    threadKeyRef.current = threadKey;
    setMessages(loadAiThread(threadKey));
    setErr("");
    setInput("");
  }, [threadKey, user?.id]);

  useEffect(() => {
    if (!ready || !docId) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    loadDoc(docId).then((d) => {
      if (!cancelled) setDoc(d || null);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, docId, dataVersion]);

  function commit(next: Msg[]) {
    setMessages(next);
    saveAiThread(threadKeyRef.current || threadKey, next);
  }

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, open]);

  const page = useMemo(() => resolveAiPageActions(pathname, doc), [pathname, doc]);

  const custExtras = useMemo(() => {
    if (!ready || !custId) return { label: "", phone: "", actions: [] as AiQuickAction[] };
    const c = getCached<Customer>("customers", custId);
    if (!c) return { label: "", phone: "", actions: [] as AiQuickAction[] };
    const name = (c.name || "").trim();
    const phone = (c.phone || "").trim();
    const quotes = listCached<Doc>("quotations");
    const invoices = listCached<Doc>("invoices");
    const expenses = listCached<Expense>("expenses");
    const fin = customerFinancials(
      custId,
      quotes,
      invoices,
      +(c.opening || 0),
      expenses,
      !!getFeatures().simpleQuote,
    );
    const actions: AiQuickAction[] = [
      {
        id: "cust-follow",
        label: "WhatsApp follow-up",
        readyText: customerFollowupMessage(name || "Customer"),
      },
    ];
    if (!isCloaked() && fin.outstanding > 0.001) {
      actions.unshift({
        id: "cust-remind",
        label: "Balance reminder",
        readyText: balanceReminderMessage({
          name,
          total: fin.billed,
          received: fin.paid,
          balance: fin.outstanding,
        }),
      });
    }
    return {
      label:
        name +
        (fin.outstanding > 0.001 && !isCloaked() ? ` · due ₹${Math.round(fin.outstanding)}` : ""),
      phone,
      actions,
    };
  }, [ready, custId, dataVersion]);

  if (!ready || !user || onAiPage || onChatPage) return null;

  const actions: AiQuickAction[] = (() => {
    const live = liveQuickActions(pathname);
    const pageActs =
      custId && custExtras.actions.length
        ? [
            ...custExtras.actions,
            ...page.actions.filter((a) => a.id !== "cust-followup" && a.id !== "whatsapp-follow-up"),
          ]
        : page.actions;
    const seen = new Set(live.map((a) => a.id));
    return [...live, ...pageActs.filter((a) => !seen.has(a.id) && a.id !== "who-owes-the-most")];
  })();

  const facts = doc ? factsFromDoc(doc) : null;
  const ctxLabel =
    (facts
      ? `${facts.kind === "invoice" ? "Inv" : "Qt"} ${facts.number}` +
        (facts.customerName ? " · " + facts.customerName : "") +
        (!isCloaked() && facts.balance > 0.001 ? " · due ₹" + Math.round(facts.balance) : "")
      : "") ||
    custExtras.label ||
    page.contextLabel ||
    "";

  const waPhone = facts?.phone || custExtras.phone || undefined;

  async function sendPrompt(text: string, asUserLabel?: string) {
    const t = text.trim();
    if (!t || busy) return;
    const jump = navIntentHref(t);
    if (jump) {
      setOpen(false);
      router.push(jump);
      return;
    }
    setErr("");
    const userLine = asUserLabel || t;
    const next: Msg[] = [...messages, { role: "user", content: userLine }];
    const apiMessages =
      asUserLabel && asUserLabel !== t
        ? [...messages, { role: "user" as const, content: t }]
        : next;
    commit(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          pathname,
          docId: doc?.id || docId || "",
          cloak: isCloaked(),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!r.ok) throw new Error(data.error || "AI failed");
      commit([...next, { role: "assistant", content: data.reply || "", waPhone }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI failed");
    } finally {
      setBusy(false);
    }
  }

  function runAction(a: AiQuickAction) {
    if (busy) return;
    if (a.href) {
      setOpen(false);
      router.push(a.href);
      return;
    }
    if (a.readyText) {
      setErr("");
      commit([
        ...messages,
        { role: "user", content: a.label },
        { role: "assistant", content: a.readyText, waPhone },
      ]);
      return;
    }
    if (a.prompt) void sendPrompt(a.prompt, a.label);
  }

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  return (
    <div className="ai-fab-root no-print">
      {open ? (
        <div className="ai-fab-panel" role="dialog" aria-label="AI assistant">
          <header className="ai-fab-panel-head">
            <div className="ai-fab-panel-titles">
              <strong>AI · {page.title}</strong>
              {ctxLabel ? <span className="ai-fab-ctx">{ctxLabel}</span> : null}
            </div>
            <div className="ai-fab-head-btns">
              {messages.length > 0 ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    clearAiThread(threadKey);
                    commit([]);
                    setErr("");
                  }}
                >
                  Clear chat
                </button>
              ) : null}
              <button type="button" className="ai-fab-x" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
          </header>

          {messages.length === 0 ? (
            <div className="ai-fab-actions">
              <p className="ai-fab-hint">Quick commands for this tab:</p>
              <div className="ai-fab-chips">
                {actions.map((a) => (
                  <button key={a.id} type="button" className="ai-fab-chip" disabled={busy} onClick={() => runAction(a)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="ai-fab-thread">
            {messages.map((m, i) => (
              <div key={i} className={"ai-fab-msg ai-fab-msg--" + m.role}>
                <div className="ai-fab-msg-body">{m.content}</div>
                {m.role === "assistant" && m.content ? (
                  <div className="ai-fab-msg-tools">
                    <button type="button" className="ai-fab-tool" onClick={() => copyText(m.content)}>
                      Copy
                    </button>
                    {m.waPhone ? (
                      <button type="button" className="ai-fab-tool" onClick={() => openWhatsApp(m.waPhone!, m.content)}>
                        WhatsApp
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? <div className="ai-fab-msg ai-fab-msg--assistant">Thinking…</div> : null}
            <div ref={endRef} />
          </div>

          {messages.length > 0 ? (
            <div className="ai-fab-more">
              {actions.slice(0, 5).map((a) => (
                <button key={a.id} type="button" className="ai-fab-chip sm" disabled={busy} onClick={() => runAction(a)}>
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}

          {err ? <p className="ai-fab-err">{err}</p> : null}
          <form
            className="ai-fab-form"
            onSubmit={(e) => {
              e.preventDefault();
              void sendPrompt(input);
            }}
          >
            <input
              className="ai-fab-input"
              placeholder="Ask about this tab…"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="btn primary sm" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className={"ai-fab" + (open ? " on" : "")}
        onClick={() => setOpen((v) => !v)}
        title={"AI · " + page.title}
        aria-label="Open AI Assistant"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" width={40} height={40} />
      </button>
    </div>
  );
}
