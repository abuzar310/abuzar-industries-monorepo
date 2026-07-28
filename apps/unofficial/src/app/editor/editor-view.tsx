"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorTabs, openTab, closeTab, setActive, setTabDirty, takeAction, takePayFocus, updateTab } from "@/lib/editor-tabs";
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
  const [docs, setDocs] = useState<Map<string, TabDoc>>(() => new Map());
  const loaded = useRef<Set<string>>(new Set());
  const barRef = useRef<HTMLDivElement>(null);

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
        updateTab(t.id, d.displayNumber || d.number, d.customerName);
        setDocs((prev) => {
          const next = new Map(prev);
          next.set(t.id, { id: t.id, doc: d, action, payFocus });
          return next;
        });
      });
    }
  }, [tabs, ready]);

  // Drop the cached doc when a tab closes, so reopening it reads the current
  // row from the cloud instead of replaying a copy another device may have moved on from.
  useEffect(() => {
    const open = new Set(tabs.map((t) => t.id));
    for (const id of loaded.current) if (!open.has(id)) loaded.current.delete(id);
    setDocs((prev) => {
      const stale = [...prev.keys()].filter((id) => !open.has(id));
      if (!stale.length) return prev;
      const next = new Map(prev);
      for (const id of stale) next.delete(id);
      return next;
    });
  }, [tabs]);

  // Keep the active tab in view when it's switched from the keyboard.
  useEffect(() => {
    barRef.current?.querySelector<HTMLElement>(".editor-tab.active")?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeId]);

  const step = useCallback(
    (delta: number) => {
      const cur = tabs.findIndex((t) => t.id === activeId);
      if (cur < 0) return;
      setActive(tabs[(cur + delta + tabs.length) % tabs.length].id);
    },
    [tabs, activeId],
  );

  // Tab-switching shortcuts. Ctrl+Tab is reserved by the browser, so:
  //   Ctrl+Shift+] / [   next / previous     Alt+→ / ←   next / previous
  //   Ctrl+1…8           jump to that tab    Ctrl+9      last tab (browser convention)
  useEffect(() => {
    if (tabs.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        const n = +e.key;
        const t = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
        if (!t) return;
        e.preventDefault();
        setActive(t.id);
        return;
      }
      if (ctrl && e.shiftKey && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        step(e.key === "]" ? 1 : -1);
        return;
      }
      if (e.altKey && !ctrl && !e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        step(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tabs, step]);

  const onNewQuote = useCallback(async () => {
    const d = await createQuotation();
    toast("New " + d.id + " created");
    openTab(d.id, d.number);
    prefSet("lastOpen", { store: "quotations", id: d.id });
  }, []);

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
      <div className="editor-tabbar" ref={barRef} role="tablist" aria-label="Open quotations">
        <button className="editor-tab-new" title="New quotation" aria-label="New quotation" onClick={onNewQuote}>+</button>
        {tabs.map((t) => {
          const active = t.id === activeId;
          const label = t.displayNumber || t.number || t.id.slice(-6);
          return (
            <div
              key={t.id}
              role="tab"
              id={"tab-" + t.id}
              aria-selected={active}
              aria-controls={"pane-" + t.id}
              tabIndex={active ? 0 : -1}
              className={"editor-tab" + (active ? " active" : "") + (t.dirty ? " dirty" : "")}
              title={t.dirty ? label + " — unsaved changes" : label}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
                else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
                else if (e.key === "Home") { e.preventDefault(); setActive(tabs[0].id); }
                else if (e.key === "End") { e.preventDefault(); setActive(tabs[tabs.length - 1].id); }
                else if (e.key === "Delete") { e.preventDefault(); closeTab(t.id); }
              }}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}
            >
              <span className="editor-tab-label">
                {label}
                {t.name && <em className="editor-tab-who">{t.name}</em>}
              </span>
              {t.dirty && <span className="editor-tab-dot" aria-label="Unsaved changes" />}
              <button
                className="editor-tab-close"
                title="Close"
                aria-label={"Close " + label}
                tabIndex={-1}
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
        const active = t.id === activeId;
        if (!td?.doc) {
          return active ? (
            <div key={t.id} className="editor-pane editor-pane-loading" role="tabpanel" id={"pane-" + t.id} aria-labelledby={"tab-" + t.id}>
              <div className="editor-loading">Opening {t.displayNumber || t.number || "quotation"}…</div>
            </div>
          ) : null;
        }
        return (
          <div
            key={t.id}
            className="editor-pane"
            role="tabpanel"
            id={"pane-" + t.id}
            aria-labelledby={"tab-" + t.id}
            hidden={!active}
            style={{ display: active ? "block" : "none" }}
          >
            <Editor
              key={td.doc.id}
              initialDoc={td.doc}
              action={td.action}
              payFocus={td.payFocus}
              active={active}
              onDirtyChange={(d) => setTabDirty(t.id, d)}
            />
          </div>
        );
      })}
    </div>
  );
}
