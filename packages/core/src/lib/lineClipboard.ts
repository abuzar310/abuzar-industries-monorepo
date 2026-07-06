// Global "line clipboard" for copy/paste of section lines BETWEEN documents.
// Lives at module scope (survives editor navigation) and mirrors to sessionStorage
// (survives a reload), so you can copy lines in one quotation and paste them into another.
import type { Row } from "./types";

const KEY = "lineClip";

function load(): Row[] {
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(KEY) : null;
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as Row[]) : [];
  } catch {
    return [];
  }
}

let mem: Row[] = load();

/** The lines currently on the clipboard (a fresh copy each call, safe to mutate). */
export function getLineClip(): Row[] {
  return mem.map((r) => ({ ...r }));
}

export function setLineClip(rows: Row[]): void {
  mem = rows.map((r) => ({ ...r }));
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* storage unavailable — module-level copy still works this session */
  }
}
