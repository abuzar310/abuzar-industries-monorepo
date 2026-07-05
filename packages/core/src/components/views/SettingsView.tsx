"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupa, pullFromCloud, testConnection, trySync } from "@/lib/cloud";
import { exportBackup, importBackup } from "@/lib/backup";
import { purgeDoc, restoreDoc, trashedDocs } from "@/lib/trash";
import { autoSnapshot, downloadSnapshot, listSnapshots, restoreSnapshot } from "@/lib/autobackup";
import { docStore } from "@/lib/doc";
import type { Doc } from "@/lib/types";
import { canInstall, promptInstall } from "@/lib/pwa";
import { getFeatures } from "@/lib/features";
import { autoPostEnabled, setAutoPost } from "@/lib/ledger-autopost";
import { bumpData, setSyncState, toast } from "@/store/app-store";
import { confirmDialog } from "@/store/dialog-store";

export default function SettingsView() {
  const router = useRouter();
  const [cloud, setCloud] = useState("Checking cloud…");
  const [autoPost, setAutoPostUI] = useState(false);
  const [trash, setTrash] = useState<Doc[]>([]);
  const [snaps, setSnaps] = useState<{ at: string; total: number }[]>([]);
  const ledgerOn = getFeatures().ledger;

  const loadTrash = () => trashedDocs().then(setTrash);
  const loadSnaps = () => listSnapshots().then(setSnaps);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setCloud(getSupa().url && getSupa().key ? "Connected to cloud" : "Local only (no cloud configured)");
    /* eslint-enable react-hooks/set-state-in-effect */
    autoPostEnabled().then(setAutoPostUI);
    loadTrash();
    loadSnaps();
  }, []);

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
