// Local backup (.json export/import) + optional File System Access folder mirror.
import { allRec, put, STORES } from "./db";
import { nowIso, cftOf, computeDoc, esc, inr, rupeesInWords } from "./calc";
import { activeBrand } from "./brand";
import type { Doc, StoreName } from "./types";

export interface Backup {
  meta: { exportedAt: string; app: string };
  customers?: unknown[];
  quotations?: unknown[];
  invoices?: unknown[];
  stock?: unknown[];
}

export async function dumpAll(): Promise<Backup> {
  const out: Backup = { meta: { exportedAt: nowIso(), app: "Abuzar Industries" } };
  for (const s of STORES) (out as unknown as Record<string, unknown>)[s] = await allRec(s);
  return out;
}

export async function exportBackup() {
  const data = await dumpAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "abuzar-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text());
  for (const s of STORES) {
    if (Array.isArray(data[s])) for (const v of data[s]) await put(s as StoreName, v);
  }
}

export function documentSnapshotHtml(d: Doc): string {
  const t = computeDoc(d);
  const secRows = d.sections
    .map((s) => {
      let cft = 0;
      const rows = s.rows
        .map((r, i) => {
          const c = cftOf(r);
          cft += c;
          return `<tr><td>${i + 1}</td><td>${r.l}</td><td>${r.w}</td><td>${r.t}</td><td>${r.pcs}</td><td>${c.toFixed(2)}</td></tr>`;
        })
        .join("");
      const amt = Math.round(cft * (+s.rate || 0) * 100) / 100;
      return `<h3>${esc(s.name)} — ₹${s.rate}/CFT</h3><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%"><tr><th>#</th><th>L(ft)</th><th>W(in)</th><th>T(in)</th><th>Pcs</th><th>CFT</th></tr>${rows}<tr><td colspan="5" align="right"><b>Total</b></td><td><b>${cft.toFixed(2)} CFT · ₹${inr(amt)}</b></td></tr></table>`;
    })
    .join("");
  const b = activeBrand();
  const idline = [b.addr, [b.phone && "Ph " + b.phone, b.web, b.gstin && "GSTIN " + b.gstin].filter(Boolean).join(" · ")]
    .filter(Boolean)
    .join("<br>");
  return `<!doctype html><meta charset="utf-8"><title>${d.number}</title>
<body style="font-family:Inter,Arial,sans-serif;max-width:760px;margin:24px auto;color:#241B12">
<h1 style="margin:0">${b.name}</h1><p>${idline}</p>
<h2>${d.kind === "invoice" ? (d.rented ? "RENTED INVOICE" : "TAX INVOICE") : "QUOTATION"} ${d.number} — ${d.date}</h2>
<p><b>Customer:</b> ${esc(d.customerName)} · ${esc(d.phone)}<br>${esc(d.site)} ${esc(d.address)}</p>
${secRows}
<p style="text-align:right;font-size:16px">Sub-total: ₹${inr(t.sub)}<br>GST ${d.gst}%: ₹${inr(t.gstAmt)}<br><b>Grand Total: ₹${inr(t.grand)}</b></p>
<p><i>${rupeesInWords(t.grand)}</i></p>
</body>`;
}

// ---- File System Access folder mirror (Chrome/Edge desktop) ----
/* eslint-disable @typescript-eslint/no-explicit-any */
let dirHandle: any = null;

export const folderConnected = () => !!dirHandle;

export async function connectFolder(): Promise<boolean> {
  const picker = (window as any).showDirectoryPicker;
  if (!picker) return false;
  const root = await picker({ id: "abuzar", mode: "readwrite" });
  const base = await root.getDirectoryHandle("Abuzar Industries", { create: true });
  await base.getDirectoryHandle("Quotations", { create: true });
  await base.getDirectoryHandle("Invoices", { create: true });
  await base.getDirectoryHandle("Database", { create: true });
  dirHandle = base;
  await writeDbSnapshot();
  return true;
}

export async function writeDbSnapshot() {
  if (!dirHandle) return;
  try {
    const db = await dirHandle.getDirectoryHandle("Database", { create: true });
    const fh = await db.getFileHandle("abuzar-data.json", { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(await dumpAll(), null, 2));
    await w.close();
  } catch (err) {
    console.warn(err);
  }
}

/** Returns the subfolder name written to, or null if no folder is connected. */
export async function saveCopyToFolder(doc: Doc): Promise<string | null> {
  if (!dirHandle) return null;
  const sub = doc.kind === "invoice" ? "Invoices" : "Quotations";
  const dh = await dirHandle.getDirectoryHandle(sub, { create: true });
  const fh = await dh.getFileHandle(doc.number + ".html", { create: true });
  const w = await fh.createWritable();
  await w.write(documentSnapshotHtml(doc));
  await w.close();
  await writeDbSnapshot();
  return sub;
}
