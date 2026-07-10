#!/usr/bin/env node
// Safe backfill for ab_invoices after UID / display-number split.
//
// DOES NOT change primary keys (existing numeric ids stay — rewriting them would break
// URLs, ledger vouchers, and device IndexedDB). Only normalizes JSON fields:
//   - data.id     === row id
//   - data.number set (from existing number or id) so lists always show a label
//   - data.tradeType: leave buys alone; set missing tradeType → "sell" (same UI behaviour
//     as today, just explicit)
//
// Usage:
//   node scripts/backfill-invoice-identity.mjs            # dry-run
//   node scripts/backfill-invoice-identity.mjs --apply    # write

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PREFIX = "ab_";

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(path.join(ROOT, ".env.local")), ...loadEnv(path.join(ROOT, "apps/official/.env.local")) };
const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
if (!BASE || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
const table = PREFIX + "invoices";

async function getAll() {
  const r = await fetch(BASE + "/rest/v1/" + table + "?select=id,data,updated_at&order=id", { headers: H });
  if (!r.ok) throw new Error("GET " + r.status + " " + (await r.text()));
  return r.json();
}

async function upsert(row) {
  const r = await fetch(BASE + "/rest/v1/" + table, {
    method: "POST",
    headers: H,
    body: JSON.stringify([row]),
  });
  if (!r.ok) throw new Error("UPSERT " + row.id + " " + r.status + " " + (await r.text()));
}

function plan(row) {
  const data = { ...(row.data || {}) };
  const patch = {};
  if (data.id !== row.id) {
    patch.id = row.id;
    data.id = row.id;
  }
  const num = String(data.number || "").trim();
  if (!num) {
    patch.number = String(row.id);
    data.number = String(row.id);
  }
  if (data.tradeType !== "buy" && data.tradeType !== "sell") {
    // explicit sell — matches previous UI default (unset === sell in filters)
    patch.tradeType = "sell";
    data.tradeType = "sell";
  }
  if (!Object.keys(patch).length) return null;
  return {
    id: row.id,
    patch,
    row: { id: row.id, data, updated_at: data.updatedAt || row.updated_at || new Date().toISOString() },
  };
}

const rows = await getAll();
const changes = rows.map(plan).filter(Boolean);

console.log("ab_invoices:", rows.length);
console.log("would patch:", changes.length, APPLY ? "(APPLYING)" : "(dry-run)");
for (const c of changes.slice(0, 30)) {
  console.log(" ", c.id, "→", c.patch);
}
if (changes.length > 30) console.log(" … +" + (changes.length - 30) + " more");

if (!APPLY) {
  console.log("\nRe-run with --apply to write.");
  process.exit(0);
}

const bak = path.join(
  ROOT,
  "scripts/backups",
  "invoice-identity-backfill-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json",
);
fs.mkdirSync(path.dirname(bak), { recursive: true });
fs.writeFileSync(bak, JSON.stringify({ table, at: new Date().toISOString(), rows }, null, 2));
console.log("backup →", bak);

let ok = 0;
for (const c of changes) {
  await upsert(c.row);
  ok++;
}
console.log("patched", ok, "rows ✓");
