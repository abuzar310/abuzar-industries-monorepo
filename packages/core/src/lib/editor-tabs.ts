// Global tab manager for the editor. Module-level state persists across
// client-side navigations (Next.js SPA), so tabs survive moving between
// /editor <-> /quotations and back.  A hard page refresh loses them — the
// same as browser tabs.
//
// Temporary tabs (id starts with "temp_") hold an in-memory Doc for comparison —
// never written to the cloud until "Save as new quotation" promotes them.
import { useSyncExternalStore } from "react";
import { clone } from "./data";
import { blankDoc } from "./doc";
import { uid } from "./calc";
import type { Doc } from "./types";

export interface TabEntry {
  id: string;
  number: string;
  displayNumber?: string;
  /** customer name — shown next to the number so a row of tabs stays readable */
  name?: string;
  /** unsaved edits in this tab (drives the dirty dot on the tab bar) */
  dirty?: boolean;
  /** in-memory comparison tab — not in the database until promoted */
  temporary?: boolean;
}

export const isTempId = (id: string) => id.startsWith("temp_");

let tabs: TabEntry[] = [];
let activeId: string | null = null;
const listeners = new Set<() => void>();
const _actions = new Map<string, string>(); // one-shot actions per tab id
const _payFocus = new Map<string, string>(); // payFocus param per tab id
/** Bodies for temporary tabs only — never persisted to cloud/localStorage. */
const tempDocs = new Map<string, Doc>();

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

/** React hook: { tabs, activeId } for the editor view.
 *  Uses useSyncExternalStore so React 19 always sees the latest external
 *  state synchronously — no stale `tabs.length === 0` race on mount. */
export function useEditorTabs(): { tabs: readonly TabEntry[]; activeId: string | null } {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Open or switch to a tab. If the id already exists, it becomes active. */
export function openTab(id: string, number = "", displayNumber?: string, action?: string, payFocus?: string) {
  const exist = tabs.findIndex((t) => t.id === id);
  if (exist >= 0) {
    activeId = id;
    if (displayNumber) tabs = tabs.map((t) => (t.id === id ? { ...t, displayNumber } : t));
    if (action) _actions.set(id, action);
    if (payFocus) _payFocus.set(id, payFocus);
    emit();
    return;
  }
  tabs = tabs.concat({ id, number, displayNumber, temporary: isTempId(id) });
  activeId = id;
  if (action) _actions.set(id, action);
  if (payFocus) _payFocus.set(id, payFocus);
  emit();
}

/** Open a temporary comparison quotation (not saved to the cloud). Returns its id. */
export function openTempTab(seed?: Partial<Doc>): string {
  const id = "temp_" + uid();
  const doc = blankDoc(id);
  if (seed) Object.assign(doc, seed, { id, kind: "quotation" as const });
  doc.id = id;
  doc.kind = "quotation";
  doc.number = ""; // no allocated number until Save as new quotation
  doc.status = "Draft";
  tempDocs.set(id, doc);
  tabs = tabs.concat({
    id,
    number: "Compare",
    name: (doc.customerName || "").trim() || "unsaved",
    temporary: true,
    dirty: false,
  });
  activeId = id;
  emit();
  return id;
}

export function getTempDoc(id: string): Doc | undefined {
  const d = tempDocs.get(id);
  return d ? clone(d) : undefined;
}

/** Update the in-memory body of a temporary tab (and its tab label). */
export function setTempDoc(id: string, doc: Doc) {
  if (!isTempId(id)) return;
  tempDocs.set(id, clone(doc));
  const name = (doc.customerName || "").trim();
  const t = tabs.find((x) => x.id === id);
  const nextName = name || "unsaved";
  if (t && t.name === nextName && t.dirty) return; // avoid thrashing the tab bar every keystroke
  tabs = tabs.map((x) =>
    x.id === id ? { ...x, name: nextName, number: "Compare", dirty: true } : x,
  );
  emit();
}

/** Replace a temp tab with a newly persisted quotation. */
export function promoteTempTab(tempId: string, persisted: Doc) {
  const i = tabs.findIndex((t) => t.id === tempId);
  tempDocs.delete(tempId);
  _actions.delete(tempId);
  _payFocus.delete(tempId);
  const entry: TabEntry = {
    id: persisted.id,
    number: persisted.number || "",
    displayNumber: persisted.displayNumber,
    name: persisted.customerName || "",
    temporary: false,
    dirty: false,
  };
  if (i < 0) {
    tabs = tabs.concat(entry);
  } else {
    tabs = tabs.map((t) => (t.id === tempId ? entry : t));
  }
  if (activeId === tempId) activeId = persisted.id;
  emit();
}

/** Close a tab. If it was the active tab, the one to its left becomes active. */
export function closeTab(id: string) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  tabs = tabs.filter((t) => t.id !== id);
  _actions.delete(id);
  _payFocus.delete(id);
  tempDocs.delete(id);
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

/** Consume a one-shot payFocus for a tab. Returns undefined once consumed. */
export function takePayFocus(id: string): string | undefined {
  const p = _payFocus.get(id);
  if (p !== undefined) _payFocus.delete(id);
  return p;
}

/** Update a tab's display number (called after the doc finishes loading). */
export function updateTab(id: string, number: string, name?: string) {
  tabs = tabs.map((t) => (t.id === id ? { ...t, number, name: name ?? t.name } : t));
  emit();
}

/** Flag unsaved edits on a tab. No-op when the flag is already correct, so the
 *  editor can call it on every keystroke without re-rendering the tab bar. */
export function setTabDirty(id: string, dirty: boolean) {
  const t = tabs.find((x) => x.id === id);
  if (!t || !!t.dirty === dirty) return;
  tabs = tabs.map((x) => (x.id === id ? { ...x, dirty } : x));
  emit();
}
