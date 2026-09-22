"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { loadDoc } from "@/lib/doc";
import {
  getTempDoc,
  isTempId,
  openTab,
  setActive,
  setTabDirty,
  updateTab,
  useEditorTabs,
} from "@/lib/editor-tabs";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import Editor from "@/components/editor/Editor";
import EditorTabs from "@/components/editor/EditorTabs";
import type { Doc } from "@/lib/types";

/**
 * URL is always a permanent quotation id.
 * Compare tabs (+) switch in memory only — they never change the address bar.
 * Each open tab keeps its own mounted Editor so the first quote is never torn down.
 */
export default function Page() {
  const { ready } = useApp();
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const routeId = decodeURIComponent(params.id);
  const { tabs, activeId } = useEditorTabs();
  const [docs, setDocs] = useState<Map<string, Doc>>(() => new Map());
  const loading = useRef<Set<string>>(new Set());

  // Never allow /editor/temp_* in the URL — bounce back to a real quote (or list).
  useEffect(() => {
    if (!isTempId(routeId)) return;
    const real = tabs.find((t) => !isTempId(t.id));
    if (real) {
      setActive(real.id);
      router.replace("/editor/" + real.id);
    } else {
      toast("Comparison tabs don't have their own link");
      router.replace("/quotations");
    }
  }, [routeId, tabs, router]);

  // Keep the URL quotation in the tab bar. Don't steal focus from an open Compare tab.
  useEffect(() => {
    if (!ready || isTempId(routeId)) return;
    openTab(routeId);
    if (!activeId || !isTempId(activeId)) setActive(routeId);
    // activeId intentionally omitted — only react to route / ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeId]);

  // Load bodies for every open tab (real from cloud, temp from memory).
  useEffect(() => {
    if (!ready && !tabs.some((t) => isTempId(t.id))) return;
    for (const t of tabs) {
      if (loading.current.has(t.id)) continue;
      loading.current.add(t.id);
      if (isTempId(t.id)) {
        const d = getTempDoc(t.id);
        if (!d) {
          loading.current.delete(t.id);
          continue;
        }
        updateTab(t.id, "Compare", d.customerName || "unsaved");
        setDocs((prev) => (prev.has(t.id) ? prev : new Map(prev).set(t.id, d)));
        continue;
      }
      loadDoc(t.id).then((d) => {
        if (!d) {
          loading.current.delete(t.id);
          toast("Not found");
          if (t.id === routeId) router.replace("/quotations");
          return;
        }
        updateTab(t.id, d.number || "", d.customerName || d.displayNumber);
        setDocs((prev) => (prev.has(t.id) ? prev : new Map(prev).set(t.id, d)));
      });
    }
  }, [ready, tabs, routeId, router]);

  // Drop cached bodies for closed tabs.
  useEffect(() => {
    const open = new Set(tabs.map((t) => t.id));
    for (const id of loading.current) if (!open.has(id)) loading.current.delete(id);
    setDocs((prev) => {
      const stale = [...prev.keys()].filter((id) => !open.has(id));
      if (!stale.length) return prev;
      const next = new Map(prev);
      for (const id of stale) next.delete(id);
      return next;
    });
  }, [tabs]);

  if (isTempId(routeId)) {
    return (
      <>
        <EditorTabs routeId={routeId} />
        <div className="sectitle">
          Compare <small>— returning…</small>
        </div>
      </>
    );
  }

  const showId = activeId && tabs.some((t) => t.id === activeId) ? activeId : routeId;

  return (
    <>
      <EditorTabs routeId={routeId} />
      {tabs.map((t) => {
        const d = docs.get(t.id);
        const active = t.id === showId;
        if (!d) {
          return active ? (
            <div key={t.id} className="sectitle">
              {isTempId(t.id) ? "Compare" : t.number || t.id} <small>— loading…</small>
            </div>
          ) : null;
        }
        return (
          <div key={t.id} hidden={!active} style={{ display: active ? "block" : "none" }}>
            <Editor
              key={d.id}
              initialDoc={d}
              temporary={isTempId(t.id)}
              action={!isTempId(t.id) && t.id === routeId ? sp.get("action") || undefined : undefined}
              payFocus={!isTempId(t.id) && t.id === routeId ? sp.get("pay") || undefined : undefined}
              active={active}
              onDirtyChange={(dirty) => setTabDirty(t.id, dirty)}
            />
          </div>
        );
      })}
      {!tabs.length && (
        <div className="sectitle">
          {routeId} <small>— loading…</small>
        </div>
      )}
    </>
  );
}
