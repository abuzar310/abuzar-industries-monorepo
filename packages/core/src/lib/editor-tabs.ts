// Global tab manager for the editor. Module-level state persists across
// client-side navigations (Next.js SPA), so tabs survive moving between
// /editor <-> /quotations and back.  A hard page refresh loses them — the
// same as browser tabs.
import { useEffect, useState } from "react";

export interface TabEntry {
  id: string;
  number: string;
}

let tabs: TabEntry[] = [];
let activeId: string | null = null;
const listeners = new Set<() => void>();
const _actions = new Map<string, string>(); // one-shot actions per tab id

function emit() {
  // React's useSyncExternalStore compares the previous cached ref with the
  // new one via Object.is — a new object per emit guarantees a re-render.
  cached = Object.freeze({ tabs: tabs.map((t) => ({ ...t })), activeId });
  for (const l of [...listeners]) l();
}

let cached: { tabs: readonly TabEntry[]; activeId: string | null } = Object.freeze({
  tabs: Object.freeze([]) as readonly TabEntry[],
  activeId: null,
});

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function getSnapshot() {
  return cached;
}

/** React hook: { tabs, activeId } for the editor view. */
export function useEditorTabs(): { tabs: readonly TabEntry[]; activeId: string | null } {
  const [s, set] = useState(getSnapshot);
  useEffect(() => subscribe(() => set(getSnapshot())));
  return s;
}

/** Open or switch to a tab. If the id already exists, it becomes active. */
export function openTab(id: string, number = "", action?: string) {
  const exist = tabs.findIndex((t) => t.id === id);
  if (exist >= 0) {
    activeId = id;
    if (action) _actions.set(id, action);
    emit();
    return;
  }
  tabs = tabs.concat({ id, number });
  activeId = id;
  if (action) _actions.set(id, action);
  emit();
}

/** Close a tab. If it was the active tab, the one to its left becomes active. */
export function closeTab(id: string) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  tabs = tabs.filter((t) => t.id !== id);
  _actions.delete(id);
  if (activeId === id) activeId = tabs.length > 0 ? tabs[Math.min(i, tabs.length - 1)].id : null;
  emit();
}

/** Switch the active tab. */
export function setActive(id: string) {
  if (tabs.some((t) => t.id === id)) {
    activeId = id;
    emit();
  }
}

/** Consume a one-shot action (print / wa) for a tab. Returns undefined once consumed. */
export function takeAction(id: string): string | undefined {
  const a = _actions.get(id);
  if (a !== undefined) _actions.delete(id);
  return a;
}

/** Update a tab's display number (called after the doc finishes loading). */
export function updateTab(id: string, number: string) {
  tabs = tabs.map((t) => (t.id === id ? { ...t, number } : t));
  emit();
}
