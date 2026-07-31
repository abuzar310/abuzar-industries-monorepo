"use client";
import {
  closeTab,
  isTempId,
  openTempTab,
  setActive,
  useEditorTabs,
} from "@/lib/editor-tabs";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/store/dialog-store";

/** Real quotation id to keep in the URL — never a temp_ compare tab. */
function urlIdFor(tabs: readonly { id: string }[], prefer?: string | null): string | null {
  if (prefer && !isTempId(prefer) && tabs.some((t) => t.id === prefer)) return prefer;
  const real = tabs.find((t) => !isTempId(t.id));
  return real?.id ?? null;
}

export default function EditorTabs({ routeId }: { routeId: string }) {
  const { tabs, activeId } = useEditorTabs();
  const router = useRouter();

  function goReal(id: string) {
    setActive(id);
    if (!isTempId(id) && id !== routeId) {
      router.push("/editor/" + id);
    }
  }

  async function onClose(t: { id: string; temporary?: boolean; dirty?: boolean }) {
    if ((t.temporary || isTempId(t.id)) && t.dirty) {
      const ok = await confirmDialog({
        title: "Close comparison?",
        message: "This tab was never saved. Closing discards everything in it.",
        confirmLabel: "Discard",
        danger: true,
      });
      if (!ok) return;
    }
    const wasActive = t.id === activeId;
    const i = tabs.findIndex((x) => x.id === t.id);
    const remaining = tabs.filter((x) => x.id !== t.id);
    closeTab(t.id);
    if (!wasActive) {
      // closed a background tab — if it was the URL quote and we're viewing a compare, keep URL on another real
      if (!isTempId(t.id) && t.id === routeId) {
        const nextUrl = urlIdFor(remaining, activeId);
        if (nextUrl && nextUrl !== routeId) router.replace("/editor/" + nextUrl);
        else if (!nextUrl) router.replace("/quotations");
      }
      return;
    }
    if (!remaining.length) {
      router.push("/quotations");
      return;
    }
    const pick = remaining[Math.min(Math.max(0, i - 1), remaining.length - 1)];
    setActive(pick.id);
    // closing a compare tab → stay on the same permanent URL
    if (isTempId(t.id)) return;
    const nextUrl = urlIdFor(remaining, pick.id);
    if (nextUrl) router.push("/editor/" + nextUrl);
    else router.push("/quotations");
  }

  function onNewTemp() {
    // comparison only — do NOT change the URL; the first quotation stays in the address bar
    openTempTab();
  }

  if (!tabs.length) {
    return (
      <div className="editor-tabs">
        <button type="button" className="etab-new" title="New comparison tab" onClick={onNewTemp}>
          +
        </button>
      </div>
    );
  }

  return (
    <div className="editor-tabs">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={
            "etab" +
            (t.id === activeId ? " active" : "") +
            (t.dirty ? " dirty" : "") +
            (t.temporary || isTempId(t.id) ? " temp" : "")
          }
          onClick={() => {
            if (isTempId(t.id) || t.temporary) {
              setActive(t.id); // stay on the permanent quotation URL
            } else {
              goReal(t.id);
            }
          }}
        >
          <span className="etab-label">
            {t.temporary || isTempId(t.id)
              ? "Compare"
              : t.displayNumber || t.number || t.id?.slice(0, 6)}
            {t.name && <small>{t.name}</small>}
          </span>
          <button
            className="etab-close"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              void onClose(t);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="etab-new" title="New comparison tab (unsaved)" onClick={onNewTemp}>
        +
      </button>
    </div>
  );
}
