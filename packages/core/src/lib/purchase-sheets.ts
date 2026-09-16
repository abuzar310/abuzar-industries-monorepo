import { nowIso, uid } from "./calc";
import { allRec, delRec, metaGetCached, metaSet, put } from "./data";
import { buildCheck, type PurchaseRead } from "./purchase-check";

// Saved purchase checks. One sheet is one supplier list the yard opened, kept in its own store so it
// never touches quotations, money or any existing table. Folders are only names and live in one
// shared setting, the same way person cards do.

export interface PurchaseFolder {
  id: string;
  name: string;
  createdAt: string;
}

export interface PurchaseSheet {
  id: string;
  folderId: string;
  name: string;
  file: string;
  read: PurchaseRead;
  ftIn: boolean;
  createdAt: string;
  /** Written on every save, so the sheet just worked on sits at the top of its folder. */
  savedAt: string;
}

export const PURCHASE_FOLDERS_KEY = "purchaseFolders";
const STORE = "purchaseSheets" as const;

/** The saved folder list with anything malformed dropped, so one bad value cannot break the screen. */
export function cleanFolders(raw: unknown): PurchaseFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: PurchaseFolder[] = [];
  for (const f of raw as Partial<PurchaseFolder>[]) {
    if (!f || typeof f.id !== "string" || !f.id) continue;
    const name = String(f.name ?? "").trim();
    if (!name || out.some((x) => x.id === f.id)) continue;
    out.push({ id: f.id, name, createdAt: String(f.createdAt || "") });
  }
  return out;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A folder needs a name, and two folders never share one. */
export function addFolder(list: PurchaseFolder[], name: string): { list: PurchaseFolder[]; folder: PurchaseFolder } | { error: string } {
  const clean = name.trim();
  if (!clean) return { error: "Type a folder name." };
  if (list.some((f) => sameName(f.name, clean))) return { error: "There is already a folder with that name." };
  const folder = { id: "PFD-" + uid(), name: clean, createdAt: nowIso() };
  return { list: [...list, folder], folder };
}

export function renameFolder(list: PurchaseFolder[], id: string, name: string): { list: PurchaseFolder[] } | { error: string } {
  const clean = name.trim();
  if (!clean) return { error: "Type a folder name." };
  if (list.some((f) => f.id !== id && sameName(f.name, clean))) return { error: "There is already a folder with that name." };
  return { list: list.map((f) => (f.id === id ? { ...f, name: clean } : f)) };
}

export const removeFolder = (list: PurchaseFolder[], id: string) => list.filter((f) => f.id !== id);

export function newSheet(folderId: string, read: PurchaseRead, ftIn: boolean, name: string, file: string): PurchaseSheet {
  const at = nowIso();
  return {
    id: "PSH-" + uid(),
    folderId,
    name: name.trim() || read.title.trim() || file.replace(/\.[^.]+$/, ""),
    file,
    read,
    ftIn,
    createdAt: at,
    savedAt: at,
  };
}

/** What a sheet row shows without opening the sheet: our totals, and whether they all match theirs. */
export function sheetTotals(sheet: PurchaseSheet): { pcs: number; cft: number; cbm: number; ok: boolean | null } {
  const check = buildCheck(sheet.read, sheet.ftIn);
  const flags = [check.pcs.ok, check.cft.ok, check.cbm.ok].filter((x) => x !== null);
  return { pcs: check.pcs.ours, cft: check.cft.ours, cbm: check.cbm.ours, ok: flags.length ? flags.every(Boolean) : null };
}

/** Newest change first. */
export const sortSheets = (sheets: PurchaseSheet[]) =>
  [...sheets].sort((a, b) => (b.savedAt || b.createdAt || "").localeCompare(a.savedAt || a.createdAt || ""));

export const sheetsIn = (sheets: PurchaseSheet[], folderId: string) => sortSheets(sheets.filter((s) => s.folderId === folderId));

/** Every folder with how many sheets it holds, and an Unfiled row when a sheet lost its folder. */
export function folderRows(folders: PurchaseFolder[], sheets: PurchaseSheet[]): { folder: PurchaseFolder; count: number }[] {
  const rows = folders.map((folder) => ({ folder, count: sheets.filter((s) => s.folderId === folder.id).length }));
  const loose = sheets.filter((s) => !folders.some((f) => f.id === s.folderId)).length;
  if (loose) rows.push({ folder: { id: "", name: "Unfiled", createdAt: "" }, count: loose });
  return rows;
}

export const loadFolders = () => cleanFolders(metaGetCached(PURCHASE_FOLDERS_KEY, [] as unknown));
export const saveFolders = (list: PurchaseFolder[]) => metaSet(PURCHASE_FOLDERS_KEY, list);
export const loadSheets = () => allRec<PurchaseSheet>(STORE);
export const saveSheet = (sheet: PurchaseSheet) => put(STORE, { ...sheet, savedAt: nowIso() });
export const deleteSheet = (id: string) => delRec(STORE, id);
