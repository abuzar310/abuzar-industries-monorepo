#!/usr/bin/env node
// One-off migration: shorten OLD invoice numbers in the cloud.
//   "INV-2026-27-2663"  ->  "2663"
//
// - ONLY touches the invoices table (ab_invoices) and its ledger vouchers
//   (ab_vouchers, whose id/sourceId embed the invoice id). Quotations and every
//   other table are left completely untouched.
// - Renames both the row primary key `id` and the JSON `data.id` / `data.number`.
// - Uses the same Supabase REST path + publishable key the app syncs with
//   (POST upsert + DELETE), which the RLS policy allows.
// - SAFE: writes a full JSON backup of both tables before any write, is a
//   read-only DRY-RUN unless you pass --apply, detects id collisions and skips
//   them (never deletes a row whose new id would clash), and is idempotent
//   (already-short ids are ignored, so re-running is harmless).
//
// Usage:
//   node scripts/migrate-invoice-numbers.mjs            # dry-run (no writes)
//   node scripts/migrate-invoice-numbers.mjs --apply    # perform the migration

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const PREFIX = "ab_"; // official (Abuzar) table namespace — see apps/official/src/app-config.ts

// ---- env (Supabase REST url + browser-safe publishable key) ----
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
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (checked .env.local + apps/official/.env.local).");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const nowIso = () => new Date().toISOString();
const OLD = /^INV-\d{4}-\d{2}-(\d+)$/; // e.g. INV-2026-27-2663 -> 2663

async function getAll(table) {
  const r = await fetch(`${BASE}/rest/v1/${table}?select=*`, { headers: H });
  if (!r.ok) throw new Error(`GET ${table} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function upsert(table, row) {
  const r = await fetch(`${BASE}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
  if (!r.ok) throw new Error(`UPSERT ${table} ${row.id} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
async function del(table, id) {
  const r = await fetch(`${BASE}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: H });
  if (!r.ok) throw new Error(`DELETE ${table} ${id} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function main() {
  console.log(`\nSupabase: ${BASE}`);
  console.log(`Mode:     ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (no writes)"}\n`);

  const invoices = await getAll(PREFIX + "invoices");
  let vouchers = [];
  try {
    vouchers = await getAll(PREFIX + "vouchers");
  } catch {
    console.log("(no ab_vouchers table / not readable — skipping ledger voucher relink)\n");
  }
  console.log(`Fetched ${invoices.length} invoices, ${vouchers.length} vouchers.`);

  // ---- backup BEFORE any write ----
  const backupDir = path.join(ROOT, "scripts", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `invoice-migration-${nowIso().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ table: PREFIX, invoices, vouchers }, null, 2));
  console.log(`Backup written: ${path.relative(ROOT, backupFile)}\n`);

  const existing = new Set(invoices.map((r) => String(r.id)));

  // ---- build invoice rename plan ----
  const plan = [];
  for (const row of invoices) {
    const id = String(row.id);
    const m = id.match(OLD);
    if (!m) continue; // already short / custom — leave it
    plan.push({ oldId: id, newId: String(parseInt(m[1], 10)), row });
  }
  // collision guard: never delete a row whose target id already exists or is shared
  const count = {};
  for (const p of plan) count[p.newId] = (count[p.newId] || 0) + 1;
  const skip = new Set();
  for (const p of plan) {
    if (p.newId !== p.oldId && existing.has(p.newId)) { p.collision = `target "${p.newId}" already exists`; skip.add(p.oldId); }
    if (count[p.newId] > 1) { p.collision = `${count[p.newId]} invoices map to "${p.newId}"`; skip.add(p.oldId); }
  }
  const migMap = new Map(plan.filter((p) => !skip.has(p.oldId)).map((p) => [p.oldId, p.newId]));

  // ---- build voucher relink plan (ids/sourceId embed the invoice id) ----
  const vplan = [];
  for (const v of vouchers) {
    const src = v.data && v.data.sourceId != null ? String(v.data.sourceId) : "";
    if (!migMap.has(src)) continue;
    const newSrc = migMap.get(src);
    const oldVid = String(v.id);
    const newVid = oldVid.endsWith(src) ? oldVid.slice(0, oldVid.length - src.length) + newSrc : oldVid;
    vplan.push({ oldVid, newVid, newSrc, row: v });
  }

  // ---- report ----
  const doable = plan.filter((p) => !skip.has(p.oldId));
  console.log(`Invoices to rename: ${doable.length}`);
  for (const p of doable) console.log(`   ${p.oldId}  ->  ${p.newId}`);
  const collided = plan.filter((p) => skip.has(p.oldId));
  if (collided.length) {
    console.log(`\n!! SKIPPED (collision — resolve manually, left untouched): ${collided.length}`);
    for (const p of collided) console.log(`   ${p.oldId}  ->  ${p.newId}   (${p.collision})`);
  }
  if (vplan.length) {
    console.log(`\nLedger vouchers to relink: ${vplan.length}`);
    for (const v of vplan) console.log(`   ${v.oldVid}  ->  ${v.newVid}  (sourceId ${v.newSrc})`);
  }
  const untouched = invoices.length - plan.length;
  console.log(`\nInvoices left as-is (already short / custom): ${untouched}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN only. Re-run with --apply to perform the ${doable.length} rename(s).\n`);
    return;
  }
  if (!doable.length && !vplan.length) {
    console.log(`\nNothing to do.\n`);
    return;
  }

  // ---- apply: create the new row first, then delete the old one ----
  console.log(`\nApplying…`);
  let done = 0;
  for (const p of doable) {
    const data = { ...p.row.data, id: p.newId, number: p.newId };
    await upsert(PREFIX + "invoices", { id: p.newId, data, updated_at: nowIso() });
    await del(PREFIX + "invoices", p.oldId);
    done++;
    console.log(`   ✓ ${p.oldId} -> ${p.newId}`);
  }
  for (const v of vplan) {
    const data = { ...v.row.data, id: v.newVid, sourceId: v.newSrc };
    await upsert(PREFIX + "vouchers", { id: v.newVid, data, updated_at: nowIso() });
    if (v.newVid !== v.oldVid) await del(PREFIX + "vouchers", v.oldVid);
    console.log(`   ✓ voucher ${v.oldVid} -> ${v.newVid}`);
  }
  console.log(`\nDone. Renamed ${done} invoice(s) and relinked ${vplan.length} voucher(s).`);
  console.log(`Backup of the pre-migration state: ${path.relative(ROOT, backupFile)}\n`);
}

main().catch((e) => {
  console.error("\nMIGRATION ERROR:", e.message);
  console.error("Nothing further was changed. Your backup (if reached) is in scripts/backups/.\n");
  process.exit(1);
});
