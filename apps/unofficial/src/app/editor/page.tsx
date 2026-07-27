"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { prefGet } from "@/lib/data";
import { openTab } from "@/lib/editor-tabs";
import { useApp } from "@/store/useApp";
import EditorView from "./editor-view";

export default function Page() {
  const { ready } = useApp();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    // Restore last-open quotation as a tab if there are no tabs yet
    const last = prefGet<{ store: string; id: string } | null>("lastOpen", null);
    if (last && last.id) {
      openTab(last.id);
    }
    setLoaded(true);
  }, [ready]);

  if (!loaded) return null;
  return <EditorView />;
}
