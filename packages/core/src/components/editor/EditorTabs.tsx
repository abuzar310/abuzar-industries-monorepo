"use client";
import { closeTab, openTab, useEditorTabs } from "@/lib/editor-tabs";
import { useRouter } from "next/navigation";

export default function EditorTabs() {
  const { tabs, activeId } = useEditorTabs();
  const router = useRouter();

  if (!tabs.length) return null;

  return (
    <div className="editor-tabs">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={"etab" + (t.id === activeId ? " active" : "") + (t.dirty ? " dirty" : "")}
          onClick={() => {
            openTab(t.id);
            router.push("/editor/" + t.id);
          }}
        >
          <span className="etab-label">
            {t.displayNumber || t.number || t.id?.slice(0, 6)}
            {t.name && <small>{t.name}</small>}
          </span>
          <button
            className="etab-close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.id);
              if (t.id === activeId && tabs.length > 1) {
                const remaining = tabs.filter((x) => x.id !== t.id);
                const next = remaining[Math.min(remaining.length - 1, 0)];
                router.push("/editor/" + next.id);
              } else if (tabs.length === 1) {
                router.push("/quotations");
              }
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
