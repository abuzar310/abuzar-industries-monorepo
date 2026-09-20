// Run: npx tsx apps/unofficial/src/excel/lib/store.check.ts
import { DEFAULT_FOLDER_ID, folderOf } from "./folder.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(folderOf(undefined) === DEFAULT_FOLDER_ID, "empty folder becomes My sheets");
ok(folderOf("") === DEFAULT_FOLDER_ID, "blank folder becomes My sheets");
ok(folderOf("   ") === DEFAULT_FOLDER_ID, "whitespace folder becomes My sheets");
ok(folderOf("fld-yard") === "fld-yard", "named folder stays");
ok(DEFAULT_FOLDER_ID === "my-sheets", "default folder id");

console.log(`excel store.check OK (${n} assertions)`);
