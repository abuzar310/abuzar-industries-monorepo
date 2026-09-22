// Whether a Univer snapshot is safe to write over the last one.
// getActiveWorkbook() / an uncommitted editor can yield an empty sheet; that must
// not replace a book that already has cells. (ponytail: skip only blank-over-filled;
// a real clear-all of every cell would also skip — rare, and Export still works.)

export function sheetHasCells(snap: {
  sheets?: Record<string, { cellData?: Record<string, unknown> } | undefined>;
} | null | undefined): boolean {
  if (!snap?.sheets) return false;
  return Object.values(snap.sheets).some((s) => !!s?.cellData && Object.keys(s.cellData).length > 0);
}

export function shouldWriteSnap(
  prev: { sheets?: Record<string, { cellData?: Record<string, unknown> } | undefined> } | null,
  next: { sheets?: Record<string, { cellData?: Record<string, unknown> } | undefined> },
): boolean {
  if (sheetHasCells(next)) return true;
  if (!prev) return true;
  return !sheetHasCells(prev);
}
