"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { loadDoc } from "@/lib/doc";
import { updateTab, useEditorTabs } from "@/lib/editor-tabs";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import Editor from "@/components/editor/Editor";
import EditorTabs from "@/components/editor/EditorTabs";
import type { Doc } from "@/lib/types";

export default function Page() {
  const { ready } = useApp();
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const id = decodeURIComponent(params.id);
  const [doc, setDoc] = useState<Doc | null | undefined>(undefined);
  const { activeId } = useEditorTabs();

  useEffect(() => {
    if (!ready) return;
    let live = true;
    loadDoc(id).then((d) => {
      if (!live) return;
      if (!d) {
        toast("Not found");
        router.replace("/quotations");
        setDoc(null);
      } else {
        setDoc(d);
        updateTab(id, d.number || "", d.customerName || d.displayNumber);
      }
    });
    return () => {
      live = false;
    };
  }, [ready, id, router]);

  return (
    <>
      <EditorTabs />
      {!doc ? (
        <div className="sectitle">
          {id} <small>— loading…</small>
        </div>
      ) : (
        <Editor key={doc.id} initialDoc={doc} action={sp.get("action") || undefined} payFocus={sp.get("pay") || undefined} active={!activeId || activeId === id} />
      )}
    </>
  );
}
