// Run: npx tsx packages/core/src/lib/purchase-sheets.check.ts
import { DATA_STORES } from "./data.ts";
import { STORE_TABLE, SYNC_TABLES, TABLE_STORE } from "../server/db.ts";
import type { PurchaseRead } from "./purchase-check.ts";
import {
  addFolder,
  cleanFolders,
  folderRows,
  newSheet,
  removeFolder,
  renameFolder,
  sheetTotals,
  sheetsIn,
  sortSheets,
  type PurchaseSheet,
} from "./purchase-sheets.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};
const near = (a: number, b: number, d = 0.001) => Math.abs(a - b) <= d;

const tally: PurchaseRead = {
  title: "Tally sheet",
  totals: { pcs: 43, cft: 42.333, cbm: 1.199 },
  lines: [
    { item: "130", l: "7", w: "5", t: "4", pcs: "42", cft: "40.833" },
    { item: "9", l: "4.5", w: "8", t: "6", pcs: "1", cft: "1.5" },
  ],
};
const sheetAt = (folderId: string, savedAt: string, read = tally): PurchaseSheet => ({
  ...newSheet(folderId, read, false, "", "list.xlsx"),
  savedAt,
});

// folders kept as plain names, with junk dropped
const folders = cleanFolders([
  { id: "PFD-1", name: " Containers ", createdAt: "2026-09-16" },
  { id: "PFD-1", name: "Twice" },
  { id: "", name: "No id" },
  { id: "PFD-2", name: "  " },
  null,
  { id: "PFD-3", name: "Local timber" },
]);
ok(folders.length === 2 && folders[0].name === "Containers" && folders[1].id === "PFD-3", "bad folders dropped, names trimmed");
ok(cleanFolders("nonsense").length === 0, "a broken setting reads as no folders");

const added = addFolder(folders, "September lot");
ok("list" in added && added.list.length === 3 && added.folder.id.startsWith("PFD-") && !!added.folder.createdAt, "a new folder gets an id and a date");
ok("error" in addFolder(folders, "   "), "a folder needs a name");
ok("error" in addFolder(folders, "containers"), "the same name twice is refused whatever the case");

const renamed = renameFolder(folders, "PFD-3", "Local mills");
ok("list" in renamed && renamed.list[1].name === "Local mills" && renamed.list[0].name === "Containers", "rename touches only that folder");
ok("error" in renameFolder(folders, "PFD-3", "Containers"), "rename cannot take another folder's name");
ok(removeFolder(folders, "PFD-1").map((f) => f.id).join() === "PFD-3", "remove drops only that folder");

// sheets
const fresh = newSheet("PFD-1", tally, false, "", "MSDU2592526.pdf");
ok(fresh.name === "Tally sheet" && fresh.id.startsWith("PSH-") && fresh.savedAt === fresh.createdAt, "a sheet takes the list title and is saved at once");
ok(newSheet("PFD-1", { ...tally, title: "" }, false, "", "MSDU2592526.pdf").name === "MSDU2592526", "with no title the file name is used");
ok(newSheet("PFD-1", tally, true, " My name ", "x.xlsx").name === "My name", "a typed name wins");

const totals = sheetTotals(fresh);
ok(near(totals.pcs, 43) && near(totals.cft, 42.333) && near(totals.cbm, 1.199, 0.002), "a sheet row shows our own totals");
ok(totals.ok === true, "all three matching their list reads as ok");
const off = sheetTotals({ ...fresh, read: { ...tally, totals: { pcs: 40, cft: 42.333, cbm: 1.199 } } });
ok(off.ok === false, "one figure off their list reads as not ok");
const none = sheetTotals({ ...fresh, read: { ...tally, totals: { pcs: null, cft: null, cbm: null } } });
ok(none.ok === null, "no supplier total means nothing to show");

const sheets = [sheetAt("PFD-1", "2026-09-14T10:00:00Z"), sheetAt("PFD-3", "2026-09-16T09:00:00Z"), sheetAt("PFD-1", "2026-09-15T08:00:00Z")];
ok(sortSheets(sheets).map((s) => s.savedAt.slice(8, 10)).join() === "16,15,14", "newest sheet first");
ok(sheetsIn(sheets, "PFD-1").map((s) => s.savedAt.slice(8, 10)).join() === "15,14", "a folder shows only its own sheets, newest first");

const rows = folderRows(folders, [...sheets, sheetAt("PFD-gone", "2026-09-13T08:00:00Z")]);
ok(rows.map((r) => r.folder.name + ":" + r.count).join() === "Containers:2,Local timber:1,Unfiled:1", "folder counts, with a lost sheet under Unfiled");
ok(folderRows(folders, []).every((r) => r.count === 0) && folderRows(folders, []).length === 2, "empty folders still show");

// a store the server never syncs looks saved but comes back empty on the next boot, so every store is checked end to end
for (const store of DATA_STORES) {
  const table = STORE_TABLE[store];
  ok(!!table, "store " + store + " has a table");
  ok(table === "documents" || TABLE_STORE[table] === store, "table " + table + " maps back to " + store);
  ok((SYNC_TABLES as readonly string[]).includes(table), "table " + table + " is sent to clients by bootstrap and changes");
}

console.log(`purchase-sheets.check OK (${n} assertions)`);
