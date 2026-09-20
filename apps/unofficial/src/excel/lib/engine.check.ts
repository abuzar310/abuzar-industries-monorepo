// Run: npx tsx apps/unofficial/src/excel/lib/engine.check.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const src = readFileSync(join(process.cwd(), "apps/unofficial/src/excel/lib/engine.ts"), "utf8");
const mobileFn = src.slice(src.indexOf("function mobile"), src.indexOf("export function startEngine"));
const desktopFn = src.slice(src.indexOf("function slimDesktop"), src.indexOf("function mobile"));

ok(mobileFn.includes("UniverMobileUIPlugin"), "phone boot uses UniverMobileUIPlugin");
ok(mobileFn.includes("UniverSheetsMobileUIPlugin"), "phone boot uses UniverSheetsMobileUIPlugin");
ok(mobileFn.includes("UniverRPCMainThreadPlugin"), "phone boot wires the official formula worker RPC");
ok(mobileFn.includes("notExecuteFormula"), "phone formula math leaves the UI thread when the worker is up");
ok(!/\bUniverUIPlugin\b/.test(mobileFn), "phone boot must not also load the desktop UI plugin");
ok(!/\bUniverSheetsUIPlugin\b/.test(mobileFn), "phone boot must not also load the desktop sheets UI plugin");
ok(!mobileFn.includes("UniverSheetsCorePreset"), "phone boot is a custom plugin list, not the desktop preset");
ok(desktopFn.includes("UniverSheetsCorePreset"), "desktop still uses the core preset");
ok(src.includes("enableHorizontal: false"), "phone hides the desktop scrollbars so a flick is not stolen");

const workerSrc = readFileSync(join(process.cwd(), "apps/unofficial/src/excel/lib/formula.worker.ts"), "utf8");
ok(workerSrc.includes("UniverSheetsCoreWorkerPreset"), "formula worker is the official sheets-core worker preset");
ok(!workerSrc.includes("createUniver"), "formula worker stays a raw Univer app so the facade/DOM does not load in the worker");

const pnpm = join(process.cwd(), "node_modules/.pnpm");
ok(existsSync(pnpm), "pnpm store is present so we can read the installed engine");
const sheetsUi = readdirSync(pnpm).find((name) => name.startsWith("@univerjs+sheets-ui@"));
ok(!!sheetsUi, "installed @univerjs/sheets-ui");
const bundle = readFileSync(join(pnpm, sheetsUi!, "node_modules/@univerjs/sheets-ui/lib/es/index.js"), "utf8");
ok(bundle.includes("iOS-like inertia"), "installed sheets-ui still has the mobile flick controller");
ok(bundle.includes("MobileSheetsScrollRenderController"), "installed sheets-ui still registers MobileSheetsScrollRenderController");
ok(bundle.includes("class SheetsScrollRenderController"), "desktop controller is still wheel+scrollbar only");
ok(!bundle.slice(bundle.indexOf("let SheetsScrollRenderController"), bundle.indexOf("let MobileSheetsScrollRenderController")).includes("_initPointerScrollEvent"), "desktop scroll controller has no flick physics — that is why we swap plugins on a phone");

console.log(`excel engine.check OK (${n} assertions)`);
