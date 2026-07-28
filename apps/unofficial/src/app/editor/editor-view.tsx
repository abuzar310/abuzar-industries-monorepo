"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditorTabs, openTab, closeTab, setActive, takeAction, takePayFocus, updateTab } from "@/lib/editor-tabs";
import { loadDoc } from "@/lib/doc";
import { createQuotation } from "@/lib/create";
import { prefSet } from "@/lib/data";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import Editor from "@/components/editor/Editor";
import type { Doc } from "@/lib/types";

interface TabDoc {
  id: string;
  doc: Doc | null;
  action?: string;
  payFocus?: string;
}

export default function EditorView() {
  const { tabs, activeId } = useEditorTabs();
  const { ready } = useApp();
  const router = useRouter();
  const [docs, setDocs] = useState<Map<string, TabDoc>>(() => new Map());
  const loaded = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!ready) return;
    for (const t of tabs) {
      if (loaded.current.has(t.id)) continue;
      loaded.current.add(t.id);
      const action = takeAction(t.id);
      const payFocus = takePayFocus(t.id);
      loadDoc(t.id).then((d) => {
        if (!d) {
          toast("Quotation not found: " + t.id);
          closeTab(t.id);
          return;
        }
        updateTab(t.id, d.displayNumber || d.number);
        setDocs((prev) => {
          const next = new Map(prev);
          next.set(t.id, { id: t.id, doc: d, action, payFocus });
          return next;
        });
      });
    }
  }, [tabs, ready]);

  // Ctrl+Shift+] / Ctrl+Shift+[ to cycle tabs (avoiding browser Tab conflicts)
  useEffect(() => {
    if (!tabs.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      const cur = tabs.findIndex((t) => t.id === activeId);
      if (cur < 0) return;
      if (e.key === "]") {
        e.preventDefault();
        setActive(tabs[(cur + 1) % tabs.length].id);
      } else if (e.key === "[") {
        e.preventDefault();
        setActive(tabs[(cur - 1 + tabs.length) % tabs.length].id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tabs, activeId]);

  // Ctrl+Alt+ArrowRight / ArrowLeft — alternative tab cycling
  useEffect(() => {
    if (!tabs.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey)) return;
      const cur = tabs.findIndex((t) => t.id === activeId);
      if (cur < 0) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setActive(tabs[(cur + 1) % tabs.length].id);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActive(tabs[(cur - 1 + tabs.length) % tabs.length].id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tabs, activeId]);

  if (!tabs.length) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </div>
        <div className="editor-empty-title">No quotation open</div>
        <p className="editor-empty-note">
          Open one from the Quotations list, or start something new.
        </p>
        <button className="btn primary" onClick={onNewQuote}>
          + Create a quotation
        </button>
      </div>
    );
  }

  return (
    <div className="editor-tabs-wrap">
      {/* tab bar */}
      <div className="editor-tabbar">
        <button className="editor-tab-new" title="New quotation" onClick={onNewQuote}>+</button>
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div key={t.id} className={"editor-tab" + (active ? " active" : "")} onClick={() => setActive(t.id)} onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}>
              <span className="editor-tab-label">{t.displayNumber || t.number || t.id.slice(-6)}</span>
              <button
                className="editor-tab-close"
                title="Close"
                onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* editor panes — only active one visible, others keep state */}
      {tabs.map((t) => {
        const td = docs.get(t.id);
        if (!td?.doc) return null;
        return (
          <div
            key={t.id}
            className="editor-pane"
            style={{ display: t.id === activeId ? "block" : "none" }}
          >
            <Editor
              key={td.doc.id}
              initialDoc={td.doc}
              action={td.action}
              payFocus={td.payFocus}
            />
          </div>
        );
      })}
    </div>
  );

  async function onNewQuote() {
    const d = await createQuotation();
    toast("New " + d.id + " created");
    openTab(d.id, d.number);
    prefSet("lastOpen", { store: "quotations", id: d.id });
  }
}
