// Run: npx tsx apps/unofficial/src/excel/license.check.ts
// Fails the check chain the moment a paid or licence-infecting package touches Personal Excel.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = ["@univerjs-pro", "hyperformula", "handsontable", "ag-grid-enterprise", "jspreadsheet"];
const root = join(process.cwd(), "apps", "unofficial");

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const name of Object.keys(deps)) {
  ok(!BANNED.some((b) => name.startsWith(b)), name + " is a banned dependency");
}
// The engine is pinned exactly, so an upgrade is always a deliberate step, never a surprise.
for (const [name, version] of Object.entries(deps)) {
  if (name.startsWith("@univerjs/")) ok(/^\d/.test(version), name + " must be pinned to an exact version, got " + version);
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
for (const file of walk(join(root, "src", "excel"))) {
  if (!/\.(ts|tsx|css|mjs|json)$/.test(file)) continue;
  // This file names the banned packages in order to ban them, so it never scans itself.
  if (file.endsWith("license.check.ts")) continue;
  const src = readFileSync(file, "utf8");
  for (const b of BANNED) ok(!src.includes(b), file + " references " + b);
}

console.log(`excel license.check OK (${n} assertions)`);
