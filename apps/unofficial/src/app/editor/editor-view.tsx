"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditorTabs, openTab, closeTab, setActive, takeAction, updateTab } from "@/lib/editor-tabs";
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
      loadDoc(t.id).then((d) => {
        if (!d) {
          toast("Quotation not found: " + t.id);
          closeTab(t.id);
          return;
        }
        updateTab(t.id, d.number);
        setDocs((prev) => {
          const next = new Map(prev);
          next.set(t.id, { id: t.id, doc: d, action });
          return next;
        });
      });
    }
  }, [tabs, ready]);

  if (!tabs.length) {
    return (
      <div style={{ textAlign: "center", padding: "54px 20px" }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 30, letterSpacing: "-.01em", color: "var(--walnut)", marginBottom: 8 }}>
          No quotation open
        </div>
        <p className="note" style={{ margin: "0 0 20px" }}>
          Open one from the Quotations list, or start something new.
        </p>
        <button className="btn primary" style={{ fontSize: 16, padding: "12px 24px" }} onClick={onNewQuote}>
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
          const td = docs.get(t.id);
          const isSub = td?.doc?.parentId;
          return (
            <div key={t.id} className={"editor-tab" + (active ? " active" : "") + (isSub ? " sub" : "")} onClick={() => setActive(t.id)}>
              <span className="editor-tab-label">{t.number || t.id.slice(-6)}{isSub ? " · sub" : ""}</span>
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
