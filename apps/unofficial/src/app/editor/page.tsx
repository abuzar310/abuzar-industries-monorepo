"use client";
import { useEffect, useRef } from "react";
import { createQuotation } from "@/lib/create";
import { openTab, useEditorTabs } from "@/lib/editor-tabs";
import { useApp } from "@/store/useApp";
import { toast } from "@/store/app-store";
import EditorView from "./editor-view";

export default function Page() {
  const { ready } = useApp();
  const { tabs } = useEditorTabs();
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    // If tabs were already opened (e.g. clicking a quote from the list),
    // just show them — no auto-create.
    if (tabs.length > 0) return;

    // Fresh visit to /editor: auto-create a new quotation.
    createQuotation().then((d) => {
      openTab(d.id, d.number);
    }).catch(() => {
      toast("Could not create quotation");
    });
  }, [ready, tabs.length]);

  return <EditorView />;
}
