"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupa, pullFromCloud, testConnection, trySync } from "@/lib/cloud";
import { exportBackup, importBackup } from "@/lib/backup";
import { purgeDoc, restoreDoc, trashedDocs } from "@/lib/trash";
import { autoSnapshot, downloadSnapshot, listSnapshots, restoreSnapshot } from "@/lib/autobackup";
import { connectFolder, disconnectFolder, folderList, folderSupported, grantAll, grantFolder, type FolderInfo, type FolderScope } from "@/lib/folderMirror";
import { docStore } from "@/lib/doc";
import type { Doc } from "@/lib/types";
import { canInstall, promptInstall } from "@/lib/pwa";
import { getFeatures } from "@/lib/features";
import { inr } from "@/lib/calc";
import { migrateAccountReceiptsToQuotes } from "@/lib/receipts";
import { autoPostEnabled, setAutoPost } from "@/lib/ledger-autopost";
import { bumpData, setSyncState, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";

export default function SettingsView() {
  const router = useRouter();
  const [cloud, setCloud] = useState("Checking cloud…");
  const [autoPost, setAutoPostUI] = useState(false);
  const [trash, setTrash] = useState<Doc[]>([]);
  const [snaps, setSnaps] = useState<{ at: string; total: number }[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const ledgerOn = getFeatures().ledger;
  const receiptsApp = getFeatures().acceptPayment;

  const loadTrash = () => trashedDocs().then(setTrash);
  const loadSnaps = () => listSnapshots().then(setSnaps);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setCloud(getSupa().url && getSupa().key ? "Connected to cloud" : "Local only (no cloud configured)");
    /* eslint-enable react-hooks/set-state-in-effect */
    autoPostEnabled().then(setAutoPostUI);
    loadTrash();
    loadSnaps();
    refreshFolder();
  }, []);

  const scopeLabel = (s: FolderScope) => (s === "invoices" ? "Invoices only" : s === "quotations" ? "Quotations only" : "Invoices + Quotations");
  const refreshFolder = () => setFolders(folderList());
  async function onAddFolder(scope: FolderScope) {
    const name = await connectFolder(scope);
    refreshFolder();
    toast(name ? `Folder "${name}" connected (${scopeLabel(scope)})` : "No folder selected");
  }
  async function onGrantFolder(i: number) {
    const ok = await grantFolder(i);
    refreshFolder();
    toast(ok ? "Folder reconnected — auto-saving" : "Access not granted");
  }
  async function onGrantAll() {
    const n = await grantAll();
    refreshFolder();
    toast(n ? `Reconnected ${n} folder${n === 1 ? "" : "s"}` : "Access not granted");
  }
  async function onDisconnectFolder(i: number) {
    await disconnectFolder(i);
    refreshFolder();
    toast("Folder removed from auto-save (files kept on disk)");
  }

  async function onBackupNow() {
    const s = await autoSnapshot();
    loadSnaps();
    toast(s ? "Backed up " + s.total + " records" : "Nothing to back up yet");
  }
  async function onRestoreSnap(at: string, total: number) {
    const ok = await confirmDialog({
      title: "Restore this backup?",
      message: `Brings back all ${total} records from this snapshot (recovers anything deleted or overwritten since). Newer items are kept.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    const n = await restoreSnapshot(at);
    bumpData();
    loadTrash();
    toast(n + " records restored");
  }

  async function onRestore(d: Doc) {
    await restoreDoc(docStore(d), d.id);
    loadTrash();
    bumpData();
    toast(d.number + " restored");
  }
  async function onPurge(d: Doc) {
    const ok = await confirmDialog({
      title: "Delete " + d.number + " forever?",
      message: "This permanently removes it and its payments. This cannot be undone.",
      confirmLabel: "Delete forever",
      danger: true,
    });
    if (!ok) return;
    await purgeDoc(docStore(d), d.id);
    loadTrash();
    bumpData();
    toast(d.number + " permanently deleted");
  }

  async function onMigrateReceipts() {
    const ok = await confirmDialog({
      title: "Apply account receipts to quotations?",
      message:
        "Re-applies past Receipts-tab payments onto each customer's open quotations, so their quotes and Statements update. Money totals don't change, a backup is taken first, and it's safe to run again.",
      confirmLabel: "Apply now",
    });
    if (!ok) return;
    await autoSnapshot(); // restore point before touching anything
    loadSnaps();
    toast("Applying…");
    const r = await migrateAccountReceiptsToQuotes();
    bumpData();
    if (r.receiptsConverted === 0) {
      toast(r.scanned ? "Nothing to apply — receipts already on quotes" : "No account receipts found");
    } else {
      toast(
        `Applied ${r.receiptsConverted} receipt${r.receiptsConverted === 1 ? "" : "s"} to ${r.quotesUpdated} quote${r.quotesUpdated === 1 ? "" : "s"}` +
          (r.leftover > 0.5 ? ` · ₹${inr(r.leftover)} kept as account credit` : ""),
      );
    }
  }

  async function toggleAutoPost(v: boolean) {
    setAutoPostUI(v);
    await setAutoPost(v);
    toast(v ? "Invoices will now post to the Ledger" : "Auto-posting off");
  }

  async function testCloud() {
    if (!getSupa().url || !getSupa().key) {
      setCloud("Local only (no cloud configured)");
      return toast("No cloud configured");
    }
    try {
      const res = await testConnection();
      if (res.ok) {
        setCloud("Connected to cloud ✓");
        setSyncState("on");
        trySync(true);
        toast("Cloud connected ✓ — syncing");
      } else if (res.status === 404) {
        setCloud("Connected, but tables are missing — run the one-time setup once");
        toast("Tables not found on the project");
      } else {
        setCloud("Cloud error: HTTP " + res.status);
        toast("Cloud error: HTTP " + res.status);
      }
    } catch {
      setCloud("Could not reach the cloud");
      toast("Could not reach the cloud");
    }
  }
  async function restore() {
    const ok = await confirmDialog({
      title: "Restore from cloud?",
      message: "Loads all records from the cloud onto this device.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    toast("Restoring…");
    const n = await pullFromCloud(true);
    setSyncState("on");
    bumpData();
    toast(n ? "Restored " + n + " records" : "Cloud is empty — nothing to restore");
  }

  function importFile() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      await importBackup(f);
      toast("Backup imported");
      bumpData();
      router.push("/");
    };
    inp.click();
  }
  async function installApp() {
    if (canInstall()) await promptInstall();
    else toast("Use the browser menu → Install / Add to Home screen");
  }


  return (
    <div>
      <div className="sectitle">
        Settings <small>— app, cloud &amp; backup</small>
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Cloud sync</div>
        <p className="note">
          Everything saves on this device first and syncs to the cloud automatically when online. Status: <b>{cloud}</b>.
        </p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={testCloud}>Check connection</button>
          <button className="btn sm" onClick={() => trySync(true)}>Sync now</button>
          <button className="btn sm" onClick={restore}>Restore from cloud</button>
        </div>
        <p className="note" style={{ marginTop: 8 }}>
          The cloud is the single source of truth — every device shows the same data and stays in sync automatically.
        </p>
      </div>

      {ledgerOn && (
        <div className="setbox">
          <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Ledger</div>
          <p className="note">
            When on, every invoice writes a Sales/Purchase voucher (and a Receipt/Payment for money received) straight into
            the Ledger. Leave off to keep the Ledger manual.
          </p>
          <label className="secline">
            <input type="checkbox" checked={autoPost} onChange={(e) => toggleAutoPost(e.target.checked)} /> Auto-post invoices
            &amp; payments to Ledger
          </label>
        </div>
      )}

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Backup</div>
        <p className="note">Export a full backup file you can keep anywhere or move to another device.</p>
        <div className="rowbtns">
          <button className="btn sm" onClick={exportBackup}>Export backup (.json)</button>
          <button className="btn sm" onClick={importFile}>Import backup</button>
        </div>
      </div>

      {receiptsApp && (
        <div className="setbox">
          <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Apply receipts to quotations</div>
          <p className="note">
            Re-applies past <b>Receipts</b> payments onto each customer&apos;s open quotations, so their quotes and
            Statements show as paid. Totals don&apos;t change, a backup is taken first, and it&apos;s safe to run again.
          </p>
          <div className="rowbtns">
            <button className="btn primary sm" onClick={onMigrateReceipts}>Apply receipts to quotations</button>
          </div>
        </div>
      )}

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Auto-save to folders</div>
        <p className="note">
          Connect one or more folders on this computer (e.g. this Mac&apos;s folder + a personal/Dropbox
          folder). Every invoice &amp; quotation is written to <b>all of them instantly</b> as it&apos;s
          created — a re-importable <b>.json</b> and a printable <b>.html</b>, plus a full database file.
          A permanent copy no bug or sync can ever touch. Each device keeps its own folders. (Chrome/Edge desktop.)
        </p>
        {!folderSupported() ? (
          <p className="note" style={{ opacity: 0.7, marginTop: 6 }}>
            This browser can&apos;t auto-save to a folder — use Chrome or Edge on a desktop.
          </p>
        ) : (
          <>
            {folders.map((f) => (
              <div className="exprow" key={f.i}>
                <span className="expnote">
                  {f.name} <small style={{ opacity: 0.8 }}>· {scopeLabel(f.scope)}</small>
                  <small style={{ color: f.granted ? "var(--ok, #2e7d32)" : "var(--danger)" }}>
                    {f.granted ? "✓ auto-saving" : "reconnects on your next click"}
                  </small>
                </span>
                {!f.granted && (
                  <button className="btn primary sm" onClick={() => onGrantFolder(f.i)}>Reconnect</button>
                )}
                <button className="btn sm" onClick={() => onDisconnectFolder(f.i)}>Remove</button>
              </div>
            ))}
            {folders.some((f) => !f.granted) && (
              <div className="rowbtns" style={{ marginTop: 6 }}>
                <button className="btn primary sm" onClick={onGrantAll}>Reconnect all folders</button>
              </div>
            )}
            <div className="rowbtns" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <button className="btn primary sm" onClick={() => onAddFolder("both")}>+ Folder (invoices + quotations)</button>
              <button className="btn sm" onClick={() => onAddFolder("invoices")}>+ Invoices-only folder</button>
              <button className="btn sm" onClick={() => onAddFolder("quotations")}>+ Quotations-only folder</button>
            </div>
            <p className="note" style={{ marginTop: 8, background: "var(--paper-2,#fbf6ea)", padding: "8px 10px", borderRadius: 8 }}>
              <b>No button to hunt for:</b> browsers drop folder access between sessions, so this app
              re-grants your connected folders <b>automatically on your first click</b> after opening —
              nothing to do. Installing the app (below) can make some browsers keep the grant permanently.
              {canInstall() && (
                <>
                  {" "}
                  <button className="btn sm" style={{ marginTop: 6 }} onClick={installApp}>Install now</button>
                </>
              )}
            </p>
          </>
        )}
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Auto-backups</div>
        <p className="note">
          Your data is snapshotted on this device automatically (a few times a day). If anything ever goes
          missing, restore it here — no cloud needed.
        </p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={onBackupNow}>Back up now</button>
        </div>
        {snaps.length === 0 ? (
          <p className="note" style={{ opacity: 0.6, marginTop: 6 }}>No snapshots yet.</p>
        ) : (
          snaps.map((s) => (
            <div className="exprow" key={s.at}>
              <span className="expnote">
                {new Date(s.at).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                <small>{s.total} records</small>
              </span>
              <button className="btn sm" onClick={() => onRestoreSnap(s.at, s.total)}>Restore</button>
              <button className="btn sm" onClick={() => downloadSnapshot(s.at)}>Download</button>
            </div>
          ))
        )}
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Recycle bin</div>
        <p className="note">
          Deleted quotations &amp; invoices are kept here — never really removed. Restore anytime, or delete forever.
        </p>
        {trash.length === 0 ? (
          <p className="note" style={{ opacity: 0.6, marginTop: 4 }}>Nothing deleted.</p>
        ) : (
          trash.map((d) => (
            <div className="exprow" key={d.id}>
              <span className="expnote">
                {d.number} — {d.customerName || "—"}
                <small>
                  {d.kind === "invoice" ? "Invoice" : "Quotation"}
                  {d.deletedAt
                    ? " · deleted " +
                      new Date(d.deletedAt).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : ""}
                </small>
              </span>
              <button className="btn sm" onClick={() => onRestore(d)}>Restore</button>
              <button className="btn warn sm" onClick={() => onPurge(d)}>Delete forever</button>
            </div>
          ))
        )}
      </div>

      <div className="setbox">
        <div className="pc-head" style={{ margin: "-14px -16px 4px" }}>Install app</div>
        <p className="note">Install to your phone / desktop — opens in its own window with a home-screen icon and enables notifications.</p>
        <div className="rowbtns">
          <button className="btn primary sm" onClick={installApp}>Install on this device</button>
        </div>
      </div>
    </div>
  );
}
