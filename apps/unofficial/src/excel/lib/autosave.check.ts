// Run: npx tsx apps/excel/src/lib/autosave.check.ts
import { makeDebounce, shouldAutosave } from "./autosave.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// edits save
ok(shouldAutosave("sheet.mutation.set-range-values"), "typing a value saves");
ok(shouldAutosave("sheet.command.insert-row"), "inserting a row saves");
ok(shouldAutosave("sheet.command.set-style"), "formatting saves");
ok(shouldAutosave("sheet.command.set-worksheet-name"), "renaming a sheet saves");
// looking around does not
ok(!shouldAutosave("sheet.operation.set-selections"), "moving the selection does not save");
ok(!shouldAutosave("sheet.operation.set-activate-cell-edit"), "activating a cell does not save");
ok(!shouldAutosave("sheet.operation.set-scroll"), "scrolling does not save");
ok(!shouldAutosave("sheet.command.set-zoom-ratio"), "zooming does not save");
ok(!shouldAutosave("sheet.operation.set-hover"), "hovering does not save");
ok(!shouldAutosave(""), "an empty id does not save");

async function debounceChecks() {
  let runs = 0;
  const d = makeDebounce(() => {
    runs++;
  }, 20);
  d.kick();
  d.kick();
  d.kick();
  ok(runs === 0, "nothing runs before the wait ends");
  await sleep(45);
  ok(runs === 1, "a burst of kicks runs once");

  d.kick();
  d.flush();
  ok(runs === 2, "flush runs a pending save at once");
  d.flush();
  ok(runs === 2, "flush with nothing pending does nothing");

  d.kick();
  d.cancel();
  await sleep(45);
  ok(runs === 2, "cancel drops a pending save");
}

debounceChecks()
  .then(() => console.log(`excel autosave.check OK (${n} assertions)`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
